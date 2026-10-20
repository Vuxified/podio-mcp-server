#!/usr/bin/env bash
set -euo pipefail

# ── CONFIG ───────────────────────────────────────────────────────────────────
INSTANCE_NAME="podio-mcp-server"
INSTANCE_TYPE="t3.micro"
KEY_NAME="n8n-access-key"
KEY_PATH="$HOME/.ssh/n8n-access-key.pem"
REGION="us-east-1"
DOMAIN="${DEPLOY_DOMAIN:?Set DEPLOY_DOMAIN, e.g. mcp.example.com}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:?Set CERTBOT_EMAIL for Certbot notices}"
APP_DIR="/home/ec2-user/podio-mcp-server"

# Track whether we provisioned a new instance this run
NEWLY_PROVISIONED=false

# ── PHASE 1: PROVISION (local, AWS CLI) ──────────────────────────────────────

echo "[deploy] Starting Phase 1: Provision"
echo ""

# ── 1a. Security Group ────────────────────────────────────────────────────────
echo "[deploy] Checking security group..."

SG_ID=$(aws ec2 describe-security-groups \
  --region "$REGION" \
  --filters "Name=tag:Name,Values=${INSTANCE_NAME}-sg" \
  --query 'SecurityGroups[0].GroupId' \
  --output text 2>/dev/null || true)

if [ "$SG_ID" = "None" ] || [ -z "$SG_ID" ]; then
  echo "[deploy] Creating security group ${INSTANCE_NAME}-sg..."

  SG_ID=$(aws ec2 create-security-group \
    --region "$REGION" \
    --group-name "${INSTANCE_NAME}-sg" \
    --description "Podio MCP Server" \
    --query 'GroupId' \
    --output text)

  aws ec2 create-tags \
    --region "$REGION" \
    --resources "$SG_ID" \
    --tags "Key=Name,Value=${INSTANCE_NAME}-sg"

  # Add inbound rules: SSH (22), HTTP (80), HTTPS (443)
  aws ec2 authorize-security-group-ingress \
    --region "$REGION" \
    --group-id "$SG_ID" \
    --ip-permissions \
      "IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=0.0.0.0/0}]" \
      "IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0}]" \
      "IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0}]" \
    > /dev/null

  echo "[deploy] Security group created: $SG_ID"
else
  echo "[deploy] Security group already exists: $SG_ID"
fi

echo ""

# ── 1b. EC2 Instance ──────────────────────────────────────────────────────────
echo "[deploy] Checking EC2 instance..."

INSTANCE_ID=$(aws ec2 describe-instances \
  --region "$REGION" \
  --filters \
    "Name=tag:Name,Values=$INSTANCE_NAME" \
    "Name=instance-state-name,Values=running,stopped" \
  --query 'Reservations[0].Instances[0].InstanceId' \
  --output text 2>/dev/null || true)

if [ "$INSTANCE_ID" = "None" ] || [ -z "$INSTANCE_ID" ]; then
  echo "[deploy] Creating new EC2 instance ($INSTANCE_TYPE)..."

  INSTANCE_ID=$(aws ec2 run-instances \
    --region "$REGION" \
    --image-id "resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64" \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$SG_ID" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME}]" \
    --query 'Instances[0].InstanceId' \
    --output text)

  echo "[deploy] Waiting for instance to be running: $INSTANCE_ID"
  aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE_ID"

  echo "[deploy] Waiting for instance status checks to pass..."
  aws ec2 wait instance-status-ok --region "$REGION" --instance-ids "$INSTANCE_ID"

  NEWLY_PROVISIONED=true
  echo "[deploy] Instance created: $INSTANCE_ID"
else
  echo "[deploy] Instance already exists: $INSTANCE_ID"
fi

echo ""

# ── 1c. Elastic IP ────────────────────────────────────────────────────────────
echo "[deploy] Checking Elastic IP..."

ALLOC_ID=$(aws ec2 describe-addresses \
  --region "$REGION" \
  --filters "Name=tag:Name,Values=${INSTANCE_NAME}-eip" \
  --query 'Addresses[0].AllocationId' \
  --output text 2>/dev/null || true)

if [ "$ALLOC_ID" = "None" ] || [ -z "$ALLOC_ID" ]; then
  echo "[deploy] Allocating new Elastic IP..."

  ALLOC_ID=$(aws ec2 allocate-address \
    --region "$REGION" \
    --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=${INSTANCE_NAME}-eip}]" \
    --query 'AllocationId' \
    --output text)

  echo "[deploy] Elastic IP allocated: $ALLOC_ID"
else
  echo "[deploy] Elastic IP already exists: $ALLOC_ID"
fi

# Associate EIP to instance (--allow-reassociation makes this idempotent)
echo "[deploy] Associating Elastic IP to instance..."
aws ec2 associate-address \
  --region "$REGION" \
  --instance-id "$INSTANCE_ID" \
  --allocation-id "$ALLOC_ID" \
  --allow-reassociation > /dev/null

PUBLIC_IP=$(aws ec2 describe-addresses \
  --region "$REGION" \
  --allocation-ids "$ALLOC_ID" \
  --query 'Addresses[0].PublicIp' \
  --output text)

echo "[deploy] Elastic IP associated: $PUBLIC_IP"
echo ""

# ── 1d. DNS check ────────────────────────────────────────────────────────────
# DNS is managed outside AWS (no Route53). The Elastic IP is static,
# so the A record only needs to be set once at your DNS provider.
echo "[deploy] Checking DNS for $DOMAIN..."

CURRENT_DNS=$(dig +short "$DOMAIN" A 2>/dev/null | head -1 || true)

if [ "$CURRENT_DNS" = "$PUBLIC_IP" ]; then
  echo "[deploy] DNS OK: $DOMAIN -> $PUBLIC_IP"
else
  echo "[deploy] ⚠ DNS mismatch: $DOMAIN -> ${CURRENT_DNS:-<no record>} (expected $PUBLIC_IP)"
  echo "[deploy] Update the A record for $DOMAIN at your DNS provider to: $PUBLIC_IP"
  if [ "$NEWLY_PROVISIONED" = "true" ]; then
    echo "[deploy] Waiting for DNS update — Certbot needs $DOMAIN to resolve to $PUBLIC_IP"
    echo "[deploy] Update DNS now, then press Enter to continue..."
    read -r
  fi
fi
echo ""

# ── Between phases: SSH connection retry loop ─────────────────────────────────
echo "[deploy] Verifying SSH connectivity (up to 10 attempts)..."

SSH_OPTS="-i $KEY_PATH -o StrictHostKeyChecking=no -o ConnectTimeout=30"
SSH_READY=false

for attempt in $(seq 1 10); do
  if ssh $SSH_OPTS "ec2-user@$PUBLIC_IP" echo "SSH OK" > /dev/null 2>&1; then
    echo "[deploy] SSH connected on attempt $attempt"
    SSH_READY=true
    break
  fi
  echo "[deploy] SSH attempt $attempt/10 failed, retrying in 10s..."
  sleep 10
done

if [ "$SSH_READY" = "false" ]; then
  echo "[deploy] ERROR: Could not establish SSH connection after 10 attempts"
  exit 1
fi

echo ""

# ── PHASE 2: CONFIGURE (remote, SSH) ─────────────────────────────────────────

echo "[deploy] Starting Phase 2: Configure"
echo ""

# ── 2a. Rsync code ───────────────────────────────────────────────────────────
echo "[deploy] Syncing code to EC2..."

rsync -az --delete \
  -e "ssh $SSH_OPTS" \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude '.podio-tokens.json' \
  --exclude 'dist' \
  --exclude '.git' \
  ./ "ec2-user@$PUBLIC_IP:$APP_DIR/"

echo "[deploy] Code synced"
echo ""

# ── 2b. Token transfer (if missing on EC2) ───────────────────────────────────
if [ -f ".podio-tokens.json" ]; then
  TOKEN_EXISTS=$(ssh $SSH_OPTS "ec2-user@$PUBLIC_IP" \
    "test -f $APP_DIR/.podio-tokens.json && echo 'yes' || echo 'no'" 2>/dev/null)

  if [ "$TOKEN_EXISTS" = "no" ]; then
    echo "[deploy] Transferring .podio-tokens.json to EC2..."
    scp $SSH_OPTS .podio-tokens.json "ec2-user@$PUBLIC_IP:$APP_DIR/.podio-tokens.json"
    ssh $SSH_OPTS "ec2-user@$PUBLIC_IP" "chmod 600 $APP_DIR/.podio-tokens.json"
    echo "[deploy] .podio-tokens.json transferred and secured"
  else
    echo "[deploy] .podio-tokens.json already exists on EC2, skipping transfer"
  fi
else
  echo "[deploy] No local .podio-tokens.json found, skipping transfer"
fi

echo ""

# ── 2c. Remote setup via SSH heredoc ─────────────────────────────────────────
echo "[deploy] Running remote setup on EC2..."
echo ""

ssh $SSH_OPTS "ec2-user@$PUBLIC_IP" DEPLOY_DOMAIN="$DOMAIN" CERTBOT_EMAIL="$CERTBOT_EMAIL" APP_DIR="$APP_DIR" bash << 'REMOTE'
set -euo pipefail

echo "[remote] Installing Node.js 22..."
sudo dnf install -y nodejs22 nodejs22-npm

echo "[remote] Setting node/npm alternatives..."
sudo alternatives --set node /usr/bin/node-22

echo "[remote] Installing dependencies and building..."
cd "$APP_DIR"
npm install --production=false
npm run build

echo ""
echo "[remote] Installing and configuring Nginx..."
sudo dnf install -y nginx
sudo cp "$APP_DIR/deploy/podio-mcp.nginx.conf" /etc/nginx/conf.d/podio-mcp.conf
sudo sed -i "s/YOUR_DOMAIN/$DEPLOY_DOMAIN/g" /etc/nginx/conf.d/podio-mcp.conf
sudo systemctl enable --now nginx

echo ""
echo "[remote] Installing Certbot (if not already present)..."
if [ ! -f /opt/certbot/bin/certbot ]; then
  sudo python3 -m venv /opt/certbot
  sudo /opt/certbot/bin/pip install --quiet certbot certbot-nginx
  sudo ln -sf /opt/certbot/bin/certbot /usr/local/bin/certbot
  echo "[remote] Certbot installed"
else
  echo "[remote] Certbot already installed"
fi

echo "[remote] Obtaining/renewing SSL certificate..."
sudo certbot --nginx \
  -d "$DEPLOY_DOMAIN" \
  --email "$CERTBOT_EMAIL" \
  --agree-tos \
  --non-interactive \
  --keep-until-expiring \
  --redirect

echo ""
echo "[remote] Setting up certbot auto-renewal cron..."
CRON_LINE="0 0,12 * * * root /opt/certbot/bin/python -c 'import random; import time; time.sleep(random.random() * 3600)' && sudo certbot renew -q"
if ! grep -qF "certbot renew" /etc/crontab 2>/dev/null; then
  echo "$CRON_LINE" | sudo tee -a /etc/crontab > /dev/null
  echo "[remote] Certbot auto-renewal cron added"
else
  echo "[remote] Certbot auto-renewal cron already present"
fi

echo ""
echo "[remote] Installing systemd service..."
NODE_BIN=$(which node-22)
sudo cp "$APP_DIR/deploy/podio-mcp.service" /etc/systemd/system/podio-mcp.service
sudo sed -i "s|__NODE_BIN__|$NODE_BIN|g" /etc/systemd/system/podio-mcp.service
sudo systemctl daemon-reload
sudo systemctl enable podio-mcp
sudo systemctl restart podio-mcp

echo ""
echo "[remote] Service status:"
sudo systemctl status podio-mcp --no-pager
REMOTE

echo ""

# ── Post-deploy: .env check ───────────────────────────────────────────────────
echo "[deploy] Checking .env on EC2..."

ENV_EXISTS=$(ssh $SSH_OPTS "ec2-user@$PUBLIC_IP" \
  "test -f $APP_DIR/.env && echo 'yes' || echo 'no'" 2>/dev/null)

echo ""

if [ "$ENV_EXISTS" = "no" ]; then
  echo "[deploy] ============================================================"
  echo "[deploy] FIRST DEPLOY: .env file is missing on EC2"
  echo "[deploy] Create it with:"
  echo ""
  echo "  ssh -i $KEY_PATH ec2-user@$PUBLIC_IP"
  echo "  cat > $APP_DIR/.env << 'EOF'"
  echo "  MCP_TRANSPORT=http"
  echo "  MCP_PORT=3000"
  echo "  PODIO_CLIENT_ID=your_client_id"
  echo "  PODIO_CLIENT_SECRET=your_client_secret"
  echo "  PODIO_REDIRECT_URI=http://localhost:8788/callback"
  echo "  EOF"
  echo ""
  echo "[deploy] After creating .env, run:"
  echo "  ssh -i $KEY_PATH ec2-user@$PUBLIC_IP 'sudo systemctl restart podio-mcp'"
  echo "[deploy] ============================================================"
else
  echo "[deploy] Deploy complete! Test: curl -s https://$DOMAIN/mcp"
fi
