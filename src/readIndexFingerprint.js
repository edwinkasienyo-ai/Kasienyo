const fs = require("fs");
const path = require("path");

/**
 * Reads markers from disk on startup so /api/build-info and the banner match THIS cwd's public/.
 */
function readPublicIndexFingerprint() {
  try {
    const htmlPath = path.join(process.cwd(), "public", "index.html");
    const text = fs.readFileSync(htmlPath, "utf8");
    const rev = (text.match(/STEP1_IDX_REV=(\d+)/) || [])[1] || null;
    const cssV = (text.match(/styles\.css\?v=(\d+)/) || [])[1] || null;
    return {
      step1_index_rev: rev ? Number(rev) : null,
      styles_css_query_v: cssV ? Number(cssV) : null
    };
  } catch (_) {
    return { step1_index_rev: null, styles_css_query_v: null };
  }
}

function readPublicDashboardFingerprint() {
  try {
    const jsPath = path.join(process.cwd(), "public", "dashboard.js");
    const htmlPath = path.join(process.cwd(), "public", "dashboard.html");
    const js = fs.readFileSync(jsPath, "utf8");
    const html = fs.readFileSync(htmlPath, "utf8");
    const bundle = (js.match(/CLIENT_UI_BUNDLE_ID\s*=\s*"([^"]+)"/) || [])[1] || null;
    const jsV = (html.match(/dashboard\.js\?v=(\d+)/) || [])[1] || null;
    const cssV = (html.match(/styles\.css\?v=(\d+)/) || [])[1] || null;
    return {
      dash_bundle_id: bundle,
      dashboard_js_query_v: jsV ? Number(jsV) : null,
      dashboard_styles_css_query_v: cssV ? Number(cssV) : null
    };
  } catch (_) {
    return {
      dash_bundle_id: null,
      dashboard_js_query_v: null,
      dashboard_styles_css_query_v: null
    };
  }
}

module.exports = {
  readPublicIndexFingerprint,
  readPublicDashboardFingerprint
};
