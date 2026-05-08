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

module.exports = { readPublicIndexFingerprint };
