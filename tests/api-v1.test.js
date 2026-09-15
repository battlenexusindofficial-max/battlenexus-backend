const request = require("supertest");
const { app } = require("../src/server");

describe("API v1 contract", () => {
  it("exposes the public health endpoint", async () => {
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.status).toBe("healthy");
  });

  it("exposes the versioned health endpoint", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty("status", "ok");
  });

  it("returns JSON for unknown routes", async () => {
    const response = await request(app).get("/api/not-real-route");

    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toMatch(/json/i);
    expect(response.body.success).toBe(false);
    expect(response.body).toHaveProperty("error");
  });

  it("exposes an auth endpoint contract", async () => {
    const response = await request(app).get("/api/v1/auth/health");

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty("service", "auth");
  });

  it("creates and signs in an admin user", async () => {
    const email = `admin.${Date.now()}@battlenexus.local`;
    const signupResponse = await request(app).post("/api/v1/auth/signup").send({
      full_name: "Admin Demo",
      email,
      password: "StrongPass123!",
    });

    expect(signupResponse.status).toBe(201);
    expect(signupResponse.body.success).toBe(true);
    expect(signupResponse.body.data.token).toBeTruthy();

    const loginResponse = await request(app).post("/api/v1/auth/login").send({
      email,
      password: "StrongPass123!",
    });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.success).toBe(true);
    expect(loginResponse.body.data.user.email).toBe(email);
  });

  it("accepts uppercase UTF-8 JSON content types", async () => {
    const email = `admin.uppercase.${Date.now()}@battlenexus.local`;

    const response = await request(app)
      .post("/api/v1/auth/signup")
      .set("Content-Type", "application/json; charset=UTF-8")
      .send({
        full_name: "Uppercase UTF8 Admin",
        email,
        password: "StrongPass123!",
      });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.email).toBe(email);
  });

  it("rejects duplicate email and phone numbers on admin signup", async () => {
    const baseEmail = `admin.phone.${Date.now()}@battlenexus.local`;
    const phoneNumber = `+1555${String(Date.now()).slice(-6)}`;

    const firstSignup = await request(app).post("/api/v1/auth/signup").send({
      full_name: "Phone Guard Admin",
      email: baseEmail,
      phone_number: phoneNumber,
      password: "StrongPass123!",
    });

    expect(firstSignup.status).toBe(201);

    const samePhoneSignup = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        full_name: "Duplicate Phone Admin",
        email: `admin.phone2.${Date.now()}@battlenexus.local`,
        phone_number: phoneNumber,
        password: "StrongPass123!",
      });

    expect(samePhoneSignup.status).toBe(409);
    expect(samePhoneSignup.body.message).toMatch(/already exists|email|phone/i);

    const sameEmailSignup = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        full_name: "Duplicate Email Admin",
        email: baseEmail,
        phone_number: `+1555${String(Date.now() + 1).slice(-6)}`,
        password: "StrongPass123!",
      });

    expect(sameEmailSignup.status).toBe(409);
    expect(sameEmailSignup.body.message).toMatch(/already exists|email|phone/i);
  });

  it("supports social admin signup and login", async () => {
    const email = `admin.social.${Date.now()}@battlenexus.local`;
    const socialSignup = await request(app)
      .post("/api/v1/auth/social")
      .send({
        provider: "google",
        full_name: "Social Admin",
        email,
        phone_number: `+1555${String(Date.now() + 2).slice(-6)}`,
      });

    expect(socialSignup.status).toBe(201);
    expect(socialSignup.body.success).toBe(true);
    expect(socialSignup.body.data.user.email).toBe(email);

    const socialLogin = await request(app).post("/api/v1/auth/social").send({
      provider: "google",
      email,
    });

    expect(socialLogin.status).toBe(200);
    expect(socialLogin.body.success).toBe(true);
    expect(socialLogin.body.data.user.email).toBe(email);
  });

  it("exposes wallet and tournament endpoints", async () => {
    const walletResponse = await request(app).get("/api/v1/wallet/balance");
    const tournamentsResponse = await request(app).get("/api/v1/tournaments");

    expect(walletResponse.status).toBe(401);
    expect(tournamentsResponse.status).toBe(200);
    expect(tournamentsResponse.body.success).toBe(true);
  });
});
