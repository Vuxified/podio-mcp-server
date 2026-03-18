// Discovery types

export interface PodioSpaceSummary {
  space_id: number;
  name: string;
  url: string;
  role: string;
  type: string;
}

export interface PodioOrg {
  org_id: number;
  name: string;
  type: "free" | "sponsored" | "premium";
  role: string;
  status: string;
  spaces: PodioSpaceSummary[];
}

export interface PodioSpace {
  space_id: number;
  name: string;
  url: string;
  org_id: number;
  role: string;
  type: string;
}

export interface PodioField {
  field_id: number;
  type: string;
  external_id: string;
  config: {
    label: string;
    description: string | null;
    required: boolean;
    settings: Record<string, unknown>;
  };
}

export interface PodioApp {
  app_id: number;
  status: string;
  space_id: number;
  config: {
    name: string;
    item_name: string;
    description?: string;
  };
  fields: PodioField[];
}

// Item types

export interface PodioItem {
  item_id: number;
  title: string;
  created_on: string;
  last_event_on: string;
  fields: Array<{
    field_id: number;
    type: string;
    external_id: string;
    label: string;
    values: unknown[];
  }>;
  [key: string]: unknown;
}

export interface PodioFilterResponse {
  total: number;
  filtered: number;
  items: PodioItem[];
}

export interface CreateItemResponse {
  item_id: number;
  title: string;
}

// View types

export interface PodioView {
  view_id: number;
  name: string;
  created_on: string;
  items: number;
}

// Webhook types

export interface PodioHook {
  hook_id: number;
  status: "active" | "inactive";
  type: string;
  url: string;
}

export interface CreateHookResponse {
  hook_id: number;
}

// Comment types

export interface PodioCommentCreatedBy {
  type: string;
  id: number;
  name: string;
  image?: { file_id: number; link: string };
}

export interface PodioComment {
  comment_id: number;
  value: string;
  external_id?: string;
  ref?: { type: string; id: number };
  like_count: number;
  is_liked: boolean;
  created_by: PodioCommentCreatedBy;
  created_on: string;
  files?: PodioFileRef[];
}

export interface AddCommentResponse {
  comment_id: number;
  granted_users: unknown[];
}

// File types (used by comment files array and by Plan 02 file upload tool)

export interface PodioFileRef {
  file_id: number;
  name: string;
  description?: string;
  mimetype: string;
  size: number;
  link: string;
}

export interface UploadFileResponse {
  file_id: number;
  name: string;
  link: string;
  mimetype: string;
  size: number;
}
