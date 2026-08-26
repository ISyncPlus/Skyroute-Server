import fs from "node:fs";
import path from "node:path";
import { generateOpenApiSpec } from "../src/http/openapi.js";

const spec = generateOpenApiSpec();
const jsonContent = JSON.stringify(spec, null, 2);

// 1. Write openapi.json to project root
const rootJsonPath = path.resolve(process.cwd(), "openapi.json");
fs.writeFileSync(rootJsonPath, jsonContent, "utf-8");
console.log(`✓ Saved OpenAPI JSON spec to: ${rootJsonPath}`);

// 2. Create a docs folder with standalone HTML viewer (zero CORS issues, self-contained)
const docsDir = path.resolve(process.cwd(), "docs");
if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

const docsJsonPath = path.join(docsDir, "openapi.json");
fs.writeFileSync(docsJsonPath, jsonContent, "utf-8");

// Standalone Swagger UI HTML file that embeds the spec directly
const swaggerHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>SkyRoute API Documentation</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
    <style>
      body { margin: 0; padding: 0; background: #fafafa; font-family: sans-serif; }
      .topbar { display: none; }
    </style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js"></script>
    <script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-standalone-preset.js"></script>
    <script>
      window.onload = () => {
        const spec = ${jsonContent};
        window.ui = SwaggerUIBundle({
          spec: spec,
          dom_id: '#swagger-ui',
          deepLinking: true,
          presets: [
            SwaggerUIBundle.presets.apis,
            SwaggerUIStandalonePreset
          ],
          plugins: [
            SwaggerUIBundle.plugins.DownloadUrl
          ],
          layout: "StandaloneLayout"
        });
      };
    </script>
  </body>
</html>`;

const htmlPath = path.join(docsDir, "index.html");
fs.writeFileSync(htmlPath, swaggerHtml, "utf-8");
console.log(`✓ Saved standalone Swagger UI HTML to: ${htmlPath}`);
