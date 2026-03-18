import { describe, expect, it } from "bun:test";
import {
  extractConfidence,
  hashPrinciple,
  manualCrystallize,
  updateConfidenceTag,
} from "../hooks/lib/graduation";

describe("graduation", () => {
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
      expect(hash.length).toBeLessThanOrEqual(61);
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

  describe("manualCrystallize", () => {
    it("should return false for non-existent principle", () => {
      const result = manualCrystallize(
        "Non-existent principle that doesn't exist in any frame",
        "test-domain"
      );
      expect(result.success).toBe(false);
    });
  });
});
