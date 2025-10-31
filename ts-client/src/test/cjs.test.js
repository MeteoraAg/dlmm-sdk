describe("CommonJS require() compatibility tests", () => {
    let DLMM;

    beforeAll(() => {
        // Test actual require() behavior
        DLMM = require("../../dist/index.js");
    });

    describe("require() import structure tests", () => {
        test("should import DLMM using require()", () => {
            expect(DLMM).toBeDefined();
        });

        test("should be a class constructor or have default export", () => {
            expect(typeof DLMM).toBe("function");
            expect(DLMM.name).toBe("DLMM");
        });

        test("should have consistent export structure", () => {
            expect(DLMM.prototype).toBeDefined();
            expect(DLMM.prototype.constructor).toBe(DLMM);
        });
    });

    describe("static methods accessibility with require()", () => {
        test("should have getAllLbPairPositionsByUser accessible", () => {
            expect(DLMM.getAllLbPairPositionsByUser).toBeDefined();
            expect(typeof DLMM.getAllLbPairPositionsByUser).toBe("function");
        });

        test("should have createLbPair accessible", () => {
            expect(DLMM.createLbPair).toBeDefined();
            expect(typeof DLMM.createLbPair).toBe("function");
        });

        test("should have createCustomizablePermissionlessLbPair accessible", () => {
            expect(DLMM.createCustomizablePermissionlessLbPair).toBeDefined();
            expect(
                typeof DLMM.createCustomizablePermissionlessLbPair
            ).toBe("function");
        });

        test("should have getLbPairs accessible", () => {
            expect(DLMM.getLbPairs).toBeDefined();
            expect(typeof DLMM.getLbPairs).toBe("function");
        });
    });

    describe("CJS usage patterns", () => {
        test("should work with destructuring require", () => {
            const exported = require("../../dist/index.js");

            expect(exported).toBeDefined();
            expect(typeof exported).toBe("function");
        });

        test("should work with direct require assignment", () => {

            expect(typeof DLMM.create).toBe("function");
            expect(typeof DLMM.getAllLbPairPositionsByUser).toBe("function");
        });

        test("should provide consistent API for CJS consumers", () => {
            const requiredMethods = [
                "createLbPair",
                "createCustomizablePermissionlessLbPair",
                "getAllLbPairPositionsByUser",
                "getLbPairs",
                "create",
            ];

            requiredMethods.forEach((method) => {
                expect(DLMM).toHaveProperty(method);
                expect(typeof DLMM[method]).toBe("function");
            });
        });
    });

    describe("CJS module.exports validation", () => {
        test("should have valid module.exports structure", () => {
            const exported = require("../../dist/index.js");

            expect(
                typeof exported === "function" || typeof exported.default === "function"
            ).toBe(true);
        });

        test("should not have double wrapping", () => {

            expect(DLMM.default).toBeUndefined();
        });

        test("should work with Node.js require caching", () => {
            const firstRequire = require("../../dist/index.js");
            const secondRequire = require("../../dist/index.js");

            expect(firstRequire).toBe(secondRequire);
        });
    });

    describe("interoperability tests", () => {
        test("should work in Node.js without type: module", () => {
            expect(typeof require).toBe("function");
            expect(DLMM).toBeDefined();
        });

        test("should have __esModule marker if using Babel/TypeScript compilation", () => {
            const exported = require("../../dist/index.js");

            if (exported.__esModule) {
                expect(exported.__esModule).toBe(true);
                expect(exported.default).toBeDefined();
            }
        });
    });

    describe("error prevention for CJS users", () => {
        test("should not require confusing import patterns", () => {

            expect(typeof DLMM).toBe("function");
            expect(DLMM.name).toBe("DLMM");
        });

        test("should prevent 'is not a function' errors with require()", () => {

            expect(() => {
                const method = DLMM.getAllLbPairPositionsByUser;
                expect(typeof method).toBe("function");
            }).not.toThrow();
        });

        test("should work with typical CJS usage in documentation", () => {

            expect(DLMM.getAllLbPairPositionsByUser).toBeDefined();
            expect(typeof DLMM.createLbPair).toBe("function");
        });
    });
});

