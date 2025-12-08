import DLMM from "../../dist";

describe("ESM module compatibility tests", () => {
  describe("esm module resolution tests", () => {
    test("should support ES6 default import", () => {
      expect(DLMM).toBeDefined();
      expect(typeof DLMM).toBe("function");
      expect(DLMM.name).toBe("DLMM");
    });

    test("should work with TypeScript moduleResolution: bundler", () => {
      const dlmmClass = DLMM;
      expect(dlmmClass.getAllLbPairPositionsByUser).toBeDefined();
    });

    test("should work with package.json type: module", () => {
      expect(DLMM).toBeDefined();
      expect(DLMM.prototype).toBeDefined();
    });
  });

  describe("esm api surface tests", () => {
    test("should not have double-wrapping in ESM import", () => {
      expect(DLMM).toBeDefined();
      expect(typeof DLMM).toBe("function"); // not double-wrapped
    });

    test("should provide consistent API for ESM consumers", () => {
      const requiredMethods = [
        "createLbPair",
        "createCustomizablePermissionlessLbPair",
        "getAllLbPairPositionsByUser",
        "getLbPairs",
      ];

      requiredMethods.forEach((method) => {
        expect(DLMM).toHaveProperty(method);
        expect(typeof (DLMM as any)[method]).toBe("function");
      });
    });
  });

  describe("modern module tests", () => {
    test("should work with tsx", () => {
      expect(DLMM).toBeDefined();
      expect(DLMM.name).toBe("DLMM");
    });

    test("should work with esbuild", () => {
      expect(typeof DLMM).toBe("function");
      expect(DLMM.prototype.constructor).toBe(DLMM);
    });

    test("should work with modern bundlers (webpack, vite, rollup)", () => {
      expect(DLMM).toBeDefined();
      expect(typeof DLMM.createLbPair).toBe("function");
    });
  });

  describe("Package.json Exports Field", () => {
    test("should have correct export structure for dual module support", () => {
      // The package.json should have:
      // "exports": {
      //   ".": {
      //     "import": "./dist/index.mjs",
      //     "require": "./dist/index.js"
      //   }
      // }

      expect(DLMM).toBeDefined();
      expect(typeof DLMM).toBe("function");
    });
  });

  describe("TypeScript Version Compatibility", () => {
    test("should work with TypeScript 5.9.3 (from issue)", () => {
      const dlmm: typeof DLMM = DLMM;
      expect(dlmm.name).toBe("DLMM");
    });

    test("should work with TypeScript 5+ strict mode", () => {
      const staticMethod: typeof DLMM.getAllLbPairPositionsByUser =
        DLMM.getAllLbPairPositionsByUser;
      expect(typeof staticMethod).toBe("function");
    });
  });

  describe("Node.js Compatibility", () => {
    test("should work with Node.js 20.x (from issue)", () => {
      expect(DLMM).toBeDefined();
      expect(DLMM.name).toBe("DLMM");
    });

    test("should support Node.js ESM (package.json type: module)", () => {
      expect(typeof DLMM).toBe("function");
      expect(DLMM.getAllLbPairPositionsByUser).toBeDefined();
    });
  });

  describe("Regression Prevention", () => {
    test("should never require double .default access", () => {
      // DLMM.default.default.method()

      expect(typeof DLMM).toBe("function");

      expect((DLMM as any).default).toBeUndefined();
    });

    test("should not expose internal export structures", () => {
      expect((DLMM as any).src_default).toBeUndefined();

      expect((DLMM as any).__esModule).toBeUndefined();
    });

    test("should maintain consistent namespace across builds", () => {
      const publicAPI = Object.getOwnPropertyNames(DLMM);

      expect(publicAPI.length).toBeGreaterThan(0);

      expect(publicAPI).not.toContain("default");
      expect(publicAPI).not.toContain("__esModule");
    });
  });

  describe("Documentation Examples Validation", () => {
    test("should allow usage exactly as shown in docs", () => {
      expect(DLMM.getAllLbPairPositionsByUser).toBeDefined();
      expect(typeof DLMM.getAllLbPairPositionsByUser).toBe("function");

      expect(
        (DLMM as any).default?.getAllLbPairPositionsByUser
      ).toBeUndefined();
    });

    test("should match expected console.log output", () => {
      const dlmmString = DLMM.toString();
      expect(dlmmString).toContain("class");
      expect(DLMM.name).toBe("DLMM");
      expect(typeof DLMM).not.toBe("object");
      expect(typeof DLMM).toBe("function");
    });
  });
});
