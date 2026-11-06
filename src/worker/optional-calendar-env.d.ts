// Optional and inactive by default. These are never required production secrets.
// Enabling requires an explicitly authorized Google OAuth client and activation.
interface Env {
 CALENDAR_SYNC_ENABLED?: string;
 GOOGLE_CALENDAR_CLIENT_ID?: string;
 GOOGLE_CALENDAR_CLIENT_SECRET?: string;
}
