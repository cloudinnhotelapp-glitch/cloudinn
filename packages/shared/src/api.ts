// API path constants shared by the API server and the web client so URLs never drift apart.

// Global path prefix that every API route starts with.
export const API_GLOBAL_PREFIX = 'api';

// Current API version number used in the URL (for example /api/v1).
export const API_VERSION = '1';

// Full base path for version 1 of the REST API.
export const API_BASE_PATH = `/${API_GLOBAL_PREFIX}/v${API_VERSION}`;
