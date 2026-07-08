import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { serve } from "@hono/node-server"; // <-- Needed for Node server binding
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
        .doc-item { padding: 10px 12px; border-radius: 6px; margin-bottom: 8px; cursor: pointer; display: flex; align-items: center; gap: 10px; background: #f8fafc; border: 1px solid #e2e8f0; font-size: 0.9rem; }
        .doc-item.active { background: #eff6ff; border-color: #bfdbfe; color: #1e40af; font-weight: 500; }
        .viewer-container { flex: 1; display: flex; flex-direction: column; background: #edf2f7; }
        .toolbar { height: 56px; background: #fff; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; }
        .toolbar-center { display: flex; align-items: center; gap: 8px; }
        .btn-tool { background: #fff; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 4px; cursor: pointer; }
        .pdf-canvas-container { flex: 1; overflow: auto; padding: 40px; display: flex; justify-content: center; }
        .pdf-page-mock { background: white; box-shadow: 0 4px 6px rgba(0,0,0,0.05); border-radius: 4px; min-height: 500px; width: 595px; border: 1px solid #cbd5e1; padding: 40px; display: flex; align-items: center; justify-content: center; text-align: center; }
      </style>
    </head>
    <body>
      <div class="sidebar">
        <div class="sidebar-header">
          <div>
            <h1>PDF Suite</h1>
            <div class="user-badge">${user.name}</div>
          </div>
          <a href="/logout" class="logout-btn">Sign Out</a>
        </div>
        <div class="upload-section">
          <form action="/upload" method="POST" enctype="multipart/form-data" id="uploadForm">
            <div class="file-input-wrapper">
              <button type="button" class="btn-upload">➕ Upload PDF</button>
              <input type="file" name="pdf" accept=".pdf" onchange="document.getElementById('uploadForm').submit();" />
            </div>
          </form>
        </div>
        <ul class="doc-list">
          <div class="doc-list-title">Your Cloud Documents</div>
          ${docListHtml}
        </ul>
      </div>
      <div class="viewer-container">
        <div class="toolbar">
          <div style="font-weight: 500;">Cloud Reader View</div>
          <div class="toolbar-center">
            <span style="font-size: 0.9rem; color: #64748b;">Connected to Cloud Database</span>
          </div>
        </div>
        <div class="pdf-canvas-container">
          <div class="pdf-page-mock">
            <div style="color: #64748b;">
              <h3>Select or upload a PDF document.</h3>
              <p style="font-size: 0.85rem; margin-top: 8px;">Your files are safely saved inside your permanent PostgreSQL relational cloud architecture tier.</p>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `);
});

// Login Interface (With Signup Capability)
app.get("/login", (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Login - PDF Viewer</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f7fb; display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .login-card { background: white; padding: 40px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.05); width: 100%; max-width: 400px; border: 1px solid #e2e8f0; margin-bottom: 20px; }
        h2 { margin-bottom: 8px; color: #0f172a; text-align: center; }
        p { color: #64748b; font-size: 0.9rem; text-align: center; margin-bottom: 24px; }
        .form-group { margin-bottom: 18px; }
        label { display: block; margin-bottom: 6px; font-size: 0.85rem; font-weight: 500; color: #334155; }
        input { width: 100%; padding: 10px 12px; border: 1px solid #cbd5e1; border-radius: 6px; box-sizing: border-box; }
        .btn-submit { background: #2563eb; color: white; padding: 11px; border: none; border-radius: 6px; width: 100%; font-weight: 500; cursor: pointer; margin-top: 10px; }
        .btn-submit:hover { background: #1d4ed8; }
        .switch-mode { text-align: center; margin-top: 15px; font-size: 0.85rem; }
        .switch-mode a { color: #2563eb; text-decoration: none; font-weight: 500; }
      </style>
    </head>
    <body>
      <div class="login-card" id="authCard">
        <h2 id="formTitle">Sign In</h2>
        <p id="formDesc">Access your permanent cloud database storage account</p>
        <form id="authForm" action="/login" method="POST">
          <div class="form-group" id="nameGroup" style="display: none;">
            <label>Full Name</label>
            <input type="text" name="name" placeholder="John Doe" id="nameInput" />
