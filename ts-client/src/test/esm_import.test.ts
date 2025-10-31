import DLMM from "../../dist";

describe("esm default import tests", () => {
  describe("default import structure tests", () => {
    test("should import DLMM as a direct reference, not a namespace", () => {
      expect(DLMM).toBeDefined();
      expect(typeof DLMM).toBe("function");
    });

    test("should be a class constructor", () => {
      expect(DLMM.name).toBe("DLMM");
      expect(DLMM.prototype).toBeDefined();
      expect(DLMM.prototype.constructor).toBe(DLMM);
    });

    test("should NOT require .default to access the class", () => {
      expect((DLMM as any).default).toBeUndefined();
    });
  });

  describe("static methods tests", () => {
    test("should have getAllLbPairPositionsByUser static method directly accessible", () => {
      expect(DLMM.getAllLbPairPositionsByUser).toBeDefined();
      expect(typeof DLMM.getAllLbPairPositionsByUser).toBe("function");
    });

    test("should have createLbPair static method directly accessible", () => {
      expect(DLMM.createLbPair).toBeDefined();
      expect(typeof DLMM.createLbPair).toBe("function");
    });

    test("should have createCustomizablePermissionlessLbPair static method directly accessible", () => {
      expect(DLMM.createCustomizablePermissionlessLbPair).toBeDefined();
      expect(typeof DLMM.createCustomizablePermissionlessLbPair).toBe(
        "function"
      );
    });

    test("should have getLbPairs static method directly accessible", () => {
      expect(DLMM.getLbPairs).toBeDefined();
      expect(typeof DLMM.getLbPairs).toBe("function");
    });

    test("should have getAllLbPairPositionsByUser static method directly accessible", () => {
      expect(DLMM.getAllLbPairPositionsByUser).toBeDefined();
      expect(typeof DLMM.getAllLbPairPositionsByUser).toBe("function");
    });
  });

  describe("typescript type tests", () => {
    test("should be compatible with TypeScript strict mode", () => {
      const DLMMClass: typeof DLMM = DLMM;
      expect(DLMMClass).toBe(DLMM);
    });

    test("should support ESM import syntax in type definitions", () => {
      const importedDLMM: typeof DLMM = DLMM;
      expect(importedDLMM.name).toBe("DLMM");
    });
  });

  describe("usage tests", () => {
    test("should allow direct usage without .default workaround", () => {
      expect(() => {
        const method = DLMM.getAllLbPairPositionsByUser;
        expect(method).toBeDefined();
      }).not.toThrow();
    });

    test("should support TypeScript 5+ bundler module resolution", () => {
      expect(DLMM).toBeDefined();
      expect(typeof DLMM.create).toBe("function");
    });
  });

  describe("backward compatibility tests", () => {
    test("should work with traditional module resolution", () => {
      expect(DLMM).toBeDefined();
      expect(DLMM.name).toBe("DLMM");
    });

    test("should have consistent behavior across import styles", () => {
      const hasStaticMethods =
        typeof DLMM.create === "function" &&
        typeof DLMM.getAllLbPairPositionsByUser === "function";
      expect(hasStaticMethods).toBe(true);
    });
  });

  describe("export validation tests", () => {
    test("should export DLMM as the default export", () => {
      expect(DLMM).toBeDefined();
      expect(DLMM.constructor.name).toBe("Function");
    });

    test("should not wrap the class in an additional object", () => {
      expect(DLMM.name).toBe("DLMM");
    });
  });

  describe("error prevention tests", () => {
    test("should prevent 'DLMM.getAllLbPairPositionsByUser is not a function' error", () => {
      expect(typeof DLMM.getAllLbPairPositionsByUser).toBe("function");

      expect(
        (DLMM as any).default?.getAllLbPairPositionsByUser
      ).toBeUndefined();
    });

    test("should not require DLMM.default.createLbPair() workaround", () => {
      expect(typeof DLMM.createLbPair).toBe("function");

      expect((DLMM as any).default).toBeUndefined();
    });

    test("should work with modern ESM tooling (tsx, esbuild, vite)", () => {
      expect(DLMM).toBeDefined();
      expect(typeof DLMM).toBe("function");
      expect(DLMM.name).toBe("DLMM");
    });
  });
});
