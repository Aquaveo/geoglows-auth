import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost/",
      },
    },
    globals: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
