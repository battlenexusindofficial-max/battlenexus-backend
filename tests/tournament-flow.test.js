const request = require("supertest");
const { app } = require("../src/server");

describe("Tournament flow contract", () => {
  it("returns a tournament list payload", async () => {
    const response = await request(app).get("/api/v1/tournaments");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty("tournaments");
  });

  it("rejects registration without auth", async () => {
    const response = await request(app)
      .post("/api/v1/registrations")
      .send({ tournament_id: 1 });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
  });
});
