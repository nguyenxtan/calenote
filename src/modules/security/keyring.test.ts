import { describe, expect, it } from "vitest";
import { createKeyring } from "./keyring";

const TEST_MASTER_KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

describe("Keyring", () => {
  it("round-trips a credential while producing distinct domain-separated digests", async () => {
    const keys = await createKeyring(TEST_MASTER_KEY);
    const encrypted = await keys.encryptCredential("connection-1", "zalo", 1, "token-value");

    expect(await keys.decryptCredential("connection-1", "zalo", 1, encrypted)).toBe("token-value");
    expect(await keys.fingerprintToken("token-value")).not.toBe(
      await keys.digestSession("token-value"),
    );
  });

  it("rejects non-canonical master keys and rejects ciphertext bound to another credential", async () => {
    await expect(createKeyring("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")).rejects.toThrow();
    await expect(createKeyring("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).rejects.toThrow();

    const keys = await createKeyring(TEST_MASTER_KEY);
    const encrypted = await keys.encryptCredential("connection-1", "telegram", 1, "token-value");

    await expect(keys.decryptCredential("connection-2", "telegram", 1, encrypted)).rejects.toThrow();
    await expect(keys.decryptCredential("connection-1", "telegram", 2, encrypted)).rejects.toThrow();
  });

  it("uses a separately bound sensitive-content envelope for each purpose and entity", async () => {
    const keys = await createKeyring(TEST_MASTER_KEY);
    const encrypted = await keys.encryptSensitive(
      "inbound-message",
      "inbound-1",
      1,
      "Nhắc tôi họp lúc 9 giờ",
    );

    expect(
      await keys.decryptSensitive("inbound-message", "inbound-1", 1, encrypted),
    ).toBe("Nhắc tôi họp lúc 9 giờ");
    await expect(
      keys.decryptSensitive("draft-title", "inbound-1", 1, encrypted),
    ).rejects.toThrow();
  });

  it("derives base64url webhook secrets that compare in constant time", async () => {
    const keys = await createKeyring(TEST_MASTER_KEY);
    const secrets = await keys.webhookSecrets("public-connection-1");

    expect(secrets.pathSecret).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(secrets.headerSecret).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(secrets.pathSecret).toHaveLength(43);
    expect(keys.constantTimeEqual(secrets.headerSecret, secrets.headerSecret)).toBe(true);
    expect(keys.constantTimeEqual(secrets.headerSecret, `${secrets.headerSecret}x`)).toBe(false);
  });
});
