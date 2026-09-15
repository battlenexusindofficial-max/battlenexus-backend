const required = (name) => {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `Missing required production environment variable: ${name}`,
    );
  }
  return value;
};

const validateProductionConfig = () => {
  if (process.env.NODE_ENV !== "production") return;

  const databaseUrl = required("DATABASE_URL");
  if (/localhost|127\.0\.0\.1/i.test(databaseUrl)) {
    throw new Error("Production DATABASE_URL must not point to localhost");
  }

  const backendUrl = required("BACKEND_URL");
  if (!backendUrl.startsWith("https://")) {
    throw new Error("Production BACKEND_URL must use HTTPS");
  }

  required("JWT_SECRET");
  required("ZAPUPI_API_KEY");
  required("ZAPUPI_BASE_URL");
  required("ZAPUPI_ENVIRONMENT");
  required("FIREBASE_PROJECT_ID");
  required("FIREBASE_CLIENT_EMAIL");
  required("FIREBASE_PRIVATE_KEY");

  if (process.env.ZAPUPI_ENVIRONMENT !== "live") {
    throw new Error("Production ZapUPI environment must be live");
  }
};

module.exports = { validateProductionConfig };
