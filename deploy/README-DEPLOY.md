# EC2 Deployment Guide — Podio MCP Server

Deploys the MCP server in Streamable HTTP mode behind Nginx + TLS on Amazon Linux 2023.

---

## 1. Prerequisites

- EC2 instance: Amazon Linux 2023, t3.micro or larger
- Security group inbound rules: 80 (HTTP) and 443 (HTTPS) from 0.0.0.0/0; do NOT open port 3000
- Domain name with an A record pointing to the EC2 public IP

---

## 2. EC2 Instance Setup

**Install nvm and Node.js 22:**
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 22
nvm use 22
node --version
```

**Clone and build:**
```bash
git clone https://github.com/YOUR_GITHUB_USER/podio-mcp-server.git
cd podio-mcp-server
npm install
npm run build
```

**Create .env from example:**
```bash
cp .env.example .env
chmod 600 .env
```

Edit `.env` with actual values:
```
PODIO_CLIENT_ID=your_client_id
PODIO_CLIENT_SECRET=your_client_secret
PODIO_REDIRECT_URI=http://localhost:8888/callback
PODIO_TOKEN_PATH=/home/ec2-user/podio-mcp-server/.podio-tokens.json
MCP_TRANSPORT=http
PORT=3000
```

Important: `PODIO_TOKEN_PATH` must be an absolute path. The `.env` file must use plain `KEY=VALUE` format — no `export` keyword, no shell expansion.

---

## 3. Transfer Tokens

Run `npm run auth` locally first if you haven't already. Then copy the tokens to EC2:

```bash
scp -i your-key.pem .podio-tokens.json ec2-user@YOUR_EC2_IP:/home/ec2-user/podio-mcp-server/.podio-tokens.json
```

On EC2:
```bash
chmod 600 /home/ec2-user/podio-mcp-server/.podio-tokens.json
```

---

## 4. Nginx + SSL

**Install Nginx:**
```bash
sudo yum install -y nginx
```

**Copy config and set your domain:**
```bash
sudo cp deploy/podio-mcp.nginx.conf /etc/nginx/conf.d/podio-mcp.conf
sudo sed -i 's/YOUR_DOMAIN/mcp.yourdomain.com/g' /etc/nginx/conf.d/podio-mcp.conf
```

**Install certbot (Amazon Linux 2023 — pip venv method):**
```bash
sudo python3 -m venv /opt/certbot
sudo /opt/certbot/bin/pip install certbot certbot-nginx
sudo ln -s /opt/certbot/bin/certbot /usr/local/bin/certbot
```

**Get SSL certificate:**
```bash
sudo systemctl start nginx
sudo certbot --nginx -d mcp.yourdomain.com
```

**Enable Nginx and set up auto-renewal:**
```bash
sudo systemctl enable nginx
echo "0 0,12 * * * root /opt/certbot/bin/python -c 'import random; import time; time.sleep(random.random() * 3600)' && sudo certbot renew -q" | sudo tee -a /etc/crontab > /dev/null
```

---

## 5. systemd Service

**Copy and configure:**
```bash
sudo cp deploy/podio-mcp.service /etc/systemd/system/podio-mcp.service
```

Update `ExecStart` with your actual node path:
```bash
which node  # e.g. /home/ec2-user/.nvm/versions/node/v22.x.x/bin/node
sudo sed -i 's|/home/ec2-user/.nvm/versions/node/v22/bin/node|YOUR_NODE_PATH|g' /etc/systemd/system/podio-mcp.service
```

**Enable and start:**
```bash
sudo systemctl daemon-reload
sudo systemctl enable podio-mcp
sudo systemctl start podio-mcp
```

**Check status:**
```bash
sudo systemctl status podio-mcp
journalctl -u podio-mcp -f
```

---

## 6. Verify

Send a test MCP initialize request:
```bash
curl -s -X POST https://YOUR_DOMAIN/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}},"id":1}'
```

Expected: JSON-RPC response with `"result"` containing server capabilities (serverInfo, protocolVersion, capabilities).

Verify GET returns 405:
```bash
curl -s https://YOUR_DOMAIN/mcp
```

---

## 7. MCP Client Configuration

Add the remote MCP server to your client:
```json
{
  "mcpServers": {
    "podio-remote": {
      "type": "streamableHttp",
      "url": "https://YOUR_DOMAIN/mcp",
      "headers": { "Authorization": "Bearer <MCP_AUTH_TOKEN>" }
    }
  }
}
```

