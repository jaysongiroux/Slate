/** Settings key for the LinkWarden extension toggle (syncs to desktop). */
export const LINKWARDEN_ENABLED_SETTING_KEY = "extensions.linkwardenEnabled";

/** Settings key for instance metadata: [{id, name, url}] (syncs to desktop). */
export const LINKWARDEN_INSTANCES_SETTING_KEY = "linkwarden.instances";

/** Settings key for encrypted tokens: {[instanceId]: ciphertext} (server-only, never replicated). */
export const LINKWARDEN_TOKENS_SETTING_KEY = "linkwarden.tokens";

export interface LinkwardenInstance {
  id: string;
  name: string;
  url: string;
}

export interface LinkwardenLink {
  id: number;
  name: string;
  type: string;
  url: string;
  description: string;
  preview: string | null;
  image: string | null;
  pdf: string | null;
  readable: string | null;
  monolith: string | null;
  textContent: string | null;
  collection: LinkwardenCollection;
  tags: LinkwardenTag[];
  createdAt: string;
  updatedAt: string;
}

export interface LinkwardenCollection {
  id: number;
  name: string;
  description: string;
  color: string;
  parentId: number | null;
  ownerId: number;
  createdAt: string;
  updatedAt: string;
  _count?: { links: number };
}

export interface LinkwardenTag {
  id: number;
  name: string;
  ownerId: number;
  createdAt: string;
  updatedAt: string;
  _count?: { links: number };
}

export interface LinkwardenLinksResponse {
  response: LinkwardenLink[];
}

export interface LinkwardenCollectionsResponse {
  response: LinkwardenCollection[];
}

export interface LinkwardenTagsResponse {
  response: LinkwardenTag[];
}
