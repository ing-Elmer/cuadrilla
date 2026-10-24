/** Runtime configuration, read from environment variables. */
export function loadConfig(env = process.env) {
  return {
    db: {
      host: env.DB_HOST ?? "localhost",
      user: env.DB_USER ?? "orders",
      password: env.DB_PASSWORD,
    },
  };
}
