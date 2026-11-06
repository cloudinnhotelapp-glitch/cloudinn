// Shape of the API health-check response, shared so the web app reads it with correct types.

// Database connection state reported by the health check (DATABASE_URL is required, so it is always configured).
export type DatabaseHealth = 'up' | 'down';

// Full body returned by GET /api/v1/health.
export interface HealthResponse {
  status: 'ok';
  service: 'hotel-management-api';
  database: DatabaseHealth;
  timestamp: string;
}
