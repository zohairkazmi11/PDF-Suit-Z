import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { serve } from "@hono/node-server";
import postgres from "postgres";

const app = new Hono();

// Connect to your external free Postgres database (Neon / Supabase)
// It will fall back to a local string if the environment variable isn't set yet
const connectionString = process.env.DATABASE_URL || "postgres://username:password@localhost:5432/database";
const sql = postgres(connectionString);

// Authentication Middleware checking the database for sessions
const authMiddleware = async (c, next) => {
  const sessionId = getCookie(c, "sessionId");
  if (!sessionId) {
    return c.redirect("/login");
  }

  // Look up the active session in the database
  const sessionResult = await sql`
    SELECT users.email, users.name 
    FROM sessions 
    JOIN users ON sessions.user_id = users.id 
    WHERE sessions.id = ${sessionId} AND sessions.expires_at > NOW()
  `;

  if (sessionResult.length === 0) {
    deleteCookie(c, "sessionId", { path: "/" });
    return c.redirect("/login");
  }

  // Store user info in context for the dashboard layout
  c.set("user", sessionResult[0]);
  await next();
};

// Main Dashboard Page
app.get("/", authMiddleware, async (c) => {
  const user = c.get("user");

  // Fetch the user's saved PDFs from the cloud database
  const userDocs = await sql`
    SELECT file_name, file_url FROM pdf_documents 
    WHERE user_email = ${user.email} 
    ORDER BY uploaded_at DESC
  `;

  // Build the document list HTML dynamically
  let docListHtml = "";
  if (userDocs.length === 0) {
    docListHtml = `<li class="doc-item" style="color: #94a3b8; pointer-events: none;">No documents uploaded yet.</li>`;
  } else {
    userDocs.forEach((doc, index) => {
      docListHtml += `
        <li class="doc-item ${index === 0 ? 'active' : ''}" onclick="window.location.href='/?file=${encodeURIComponent(doc.file_url)}'">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
          ${doc.file_name}
        </li>
      `;
    });
  }

  return c.html(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>PDF Viewer Suite</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f7fb; color: #1e293b; display: flex; height: 100vh; }
        .sidebar { width: 280px; background: #fff; border-right: 1px solid #e2e8f0; display: flex; flex-direction: column; }
        .sidebar-header { padding: 20px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; }
        .sidebar-header h1 { font-size: 1.2rem; color: #0f172a; font-weight: 600; }
        .user-badge { font-size: 0.85rem; color: #64748b; margin-top: 4px; }
        .logout-btn { padding: 4px 8px; font-size: 0.8rem; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 4px; cursor: pointer; text-decoration: none; color: #64748b; }
        .logout-btn:hover { background: #e2e8f0; color: #0f172a; }
        .upload-section { padding: 20px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
        .file-input-wrapper { position: relative; overflow: hidden; display: inline-block; width: 100%; }
        .btn-upload { background: #2563eb; color: white; padding: 10px; border-radius: 6px; border: none; font-weight: 500; width: 100%; cursor: pointer; display: block; text-align: center; }
        .file-input-wrapper input[type=file] { font-size: 100px; position: absolute; left: 0; top: 0; opacity: 0; cursor: pointer; }
        .doc-list { list-style: none; padding: 15px; flex: 1; overflow-y: auto; }
        .doc-list-title { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; margin-bottom: 10px; font-weight: 700; }
        .doc-item { padding: 10px 12px; border-radius: 6px; margin-bottom
