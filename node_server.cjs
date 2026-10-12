const path = require("path");
const express = require("express");
const { createRequestHandler } = require("@remix-run/express");
require("dotenv").config();
const app = express();
const build = require("./build/server");  

// Serve static files from /public
app.use(express.static("./build/client"));

// Remix request handler
app.all(
  "*",
  createRequestHandler({
    build,
    mode: process.env.NODE_ENV,
  })
);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Express server listening on http://localhost:${port}`);
});
