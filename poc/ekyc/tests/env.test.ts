import { afterEach, describe, expect, test } from "vitest";
import {
  getAppBaseUrl,
  getDiditBaseUrl,
  getRequiredEnv,
  getWebhookSecret,
} from "@/lib/env";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("getRequiredEnv", () => {
  test("returns the value when set", () => {
    process.env.DIDIT_API_KEY = "key-123";
    expect(getRequiredEnv("DIDIT_API_KEY")).toBe("key-123");
  });

  test("throws a descriptive error when missing", () => {
    delete process.env.DIDIT_WORKFLOW_ID;
    expect(() => getRequiredEnv("DIDIT_WORKFLOW_ID")).toThrow(
      /DIDIT_WORKFLOW_ID/,
    );
  });
});

describe("optional envs with defaults", () => {
  test("didit base url defaults to production", () => {
    delete process.env.DIDIT_BASE_URL;
    expect(getDiditBaseUrl()).toBe("https://verification.didit.me");
    process.env.DIDIT_BASE_URL = "http://localhost:9999";
    expect(getDiditBaseUrl()).toBe("http://localhost:9999");
  });

  test("app base url defaults to localhost:3000", () => {
    delete process.env.APP_BASE_URL;
    expect(getAppBaseUrl()).toBe("http://localhost:3000");
  });

  test("webhook secret is null when unset", () => {
    delete process.env.DIDIT_WEBHOOK_SECRET_KEY;
    expect(getWebhookSecret()).toBeNull();
    process.env.DIDIT_WEBHOOK_SECRET_KEY = "sec";
    expect(getWebhookSecret()).toBe("sec");
  });
});
