import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  addValidation,
  extractConfidence,
  hashPrinciple,
  manualCrystallize,
  updateConfidenceTag,
} from "../hooks/lib/graduation";

// Use isolated test file for validation counter
const testCounterPath = resolve(import.meta.dir, ".test-validation-counter.json");
process.env.PAI_VALIDATION_COUNTER = testCounterPath;

describe("graduation", () => {
  beforeAll(() => {
    // Ensure test directory exists
    const dir = dirname(testCounterPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  });

  afterAll(() => {
    // Clean up test file
    if (existsSync(testCounterPath)) {
      unlinkSync(testCounterPath);
    }
    // Clean up env var
    delete process.env.PAI_VALIDATION_COUNTER;
  });

  describe("hashPrinciple", () => {
    it("should generate consistent hashes", () => {
      const text = "Always test your code thoroughly";
      const hash1 = hashPrinciple(text);
      const hash2 = hashPrinciple(text);
      expect(hash1).toBe(hash2);
    });

    it("should truncate long text to 60 chars", () => {
      const long = "a".repeat(100);
      const hash = hashPrinciple(long);
      expect(hash.length).toBeLessThanOrEqual(61); // 60 chars + possible hyphens
    });
  });

  describe("extractConfidence", () => {
    it("should extract confidence value", () => {
      const line = "- Test principle [confidence: 70%]";
      expect(extractConfidence(line)).toBe(70);
    });

    it("should extract CRYSTAL value", () => {
      const line = "- Test principle [CRYSTAL: 90%]";
      expect(extractConfidence(line)).toBe(90);
    });

    it("should return null for no tag", () => {
      const line = "- Test principle without tag";
      expect(extractConfidence(line)).toBeNull();
    });
  });

  describe("updateConfidenceTag", () => {
    it("should update confidence to 85%", () => {
      const line = "- Test principle [confidence: 70%]";
      const updated = updateConfidenceTag(line, 85);
      expect(updated).toBe("- Test principle [confidence: 85%]");
    });

    it("should update confidence to CRYSTAL", () => {
      const line = "- Test principle [confidence: 85%]";
      const updated = updateConfidenceTag(line, 90);
      expect(updated).toBe("- Test principle [CRYSTAL: 90%]");
    });

    it("should return original if no confidence tag", () => {
      const line = "- Test principle without tag";
      expect(updateConfidenceTag(line, 90)).toBe(line);
    });
  });

  describe("addValidation", () => {
    it("should track new principle", () => {
      const uniqueText = `Unique principle ${Date.now()} ${Math.random()}`;
      const line = `- ${uniqueText} [confidence: 70%]`;
      const result = addValidation(line, "test-domain");
      expect(result.promoted).toBe(false);
      expect(result.newConfidence).toBeNull();
    });

    it("should promote after 3 validations (70% -> 85%)", () => {
      // Create unique principle to avoid conflicts
      const uniqueText = `Test principle ${Date.now()} ${Math.random()}`;
      const line = `- ${uniqueText} [confidence: 70%]`;
      const domain = "test";

      // First validation
      const r1 = addValidation(line, domain);
      expect(r1.promoted).toBe(false);

      // Second validation
      const r2 = addValidation(line, domain);
      expect(r2.promoted).toBe(false);

      // Third validation - should promote
      const r3 = addValidation(line, domain);
      expect(r3.promoted).toBe(true);
      expect(r3.newConfidence).toBe(85);
    });
  });

  describe("manualCrystallize", () => {
    it("should immediately promote to CRYSTAL", () => {
      const uniqueText = `Crystallize test ${Date.now()} ${Math.random()}`;
      const line = `- ${uniqueText} [confidence: 70%]`;
      const result = manualCrystallize(line, "test-domain");
      expect(result.success).toBe(true);
      expect(result.newConfidence).toBe(90);
    });
  });
});
