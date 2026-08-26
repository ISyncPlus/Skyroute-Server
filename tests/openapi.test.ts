import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { generateOpenApiSpec } from "../src/http/openapi.js";

describe("OpenAPI / Swagger documentation", () => {
  it("generates a valid OpenAPI 3.0 specification", () => {
    const spec = generateOpenApiSpec();

    expect(spec.openapi).toBe("3.0.0");
    expect(spec.info.title).toBe("SkyRoute Flight Booking API");
    expect(spec.paths).toBeDefined();

    // Verify key paths exist in the spec
    expect(spec.paths["/api/health"]).toBeDefined();
    expect(spec.paths["/api/auth/register"]).toBeDefined();
    expect(spec.paths["/api/auth/login"]).toBeDefined();
    expect(spec.paths["/api/flights/search"]).toBeDefined();
    expect(spec.paths["/api/bookings"]).toBeDefined();
    expect(spec.paths["/api/admin/stats"]).toBeDefined();
  });

  it("serves the OpenAPI JSON spec via HTTP", async () => {
    const app = createApp();
    const res = await request(app).get("/api/docs.json");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/json/);
    expect(res.body.openapi).toBe("3.0.0");
    expect(res.body.info.title).toBe("SkyRoute Flight Booking API");
  });

  it("serves the Swagger UI HTML documentation", async () => {
    const app = createApp();
    const res = await request(app).get("/api/docs/");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/html/);
    expect(res.text).toContain("Swagger UI");
  });

  it("points to documentation from the root endpoint", async () => {
    const app = createApp();
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.body.documentation).toBe("/api/docs");
    expect(res.body.openapi).toBe("/api/docs.json");
  });
});
