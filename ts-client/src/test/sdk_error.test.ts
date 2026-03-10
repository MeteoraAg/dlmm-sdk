// Run: cd ts-client && npx jest src/test/sdk_error.test.ts
import { DlmmSdkError, SdkErrorCode } from "../dlmm/error";

describe("DlmmSdkError", () => {
  describe("constructor", () => {
    test("should use default message when no custom message provided", () => {
      const error = new DlmmSdkError(
        SdkErrorCode.SWAP_QUOTE_INSUFFICIENT_LIQUIDITY
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(DlmmSdkError);
      expect(error.code).toBe(SdkErrorCode.SWAP_QUOTE_INSUFFICIENT_LIQUIDITY);
      expect(error.name).toBe("SWAP_QUOTE_INSUFFICIENT_LIQUIDITY");
      expect(error.message).toBe("Insufficient liquidity");
    });

    test("should use custom message when provided", () => {
      const error = new DlmmSdkError(
        SdkErrorCode.SWAP_QUOTE_INSUFFICIENT_LIQUIDITY,
        "Insufficient liquidity in binArrays for swapQuote"
      );

      expect(error.code).toBe(SdkErrorCode.SWAP_QUOTE_INSUFFICIENT_LIQUIDITY);
      expect(error.message).toBe(
        "Insufficient liquidity in binArrays for swapQuote"
      );
    });

    test("should set correct fields for INVALID_MAX_EXTRA_BIN_ARRAYS", () => {
      const error = new DlmmSdkError(
        SdkErrorCode.INVALID_MAX_EXTRA_BIN_ARRAYS
      );

      expect(error.code).toBe(SdkErrorCode.INVALID_MAX_EXTRA_BIN_ARRAYS);
      expect(error.name).toBe("INVALID_MAX_EXTRA_BIN_ARRAYS");
      expect(error.message).toBe("Max extra bin arrays value is invalid");
    });

    test("should override default message with custom message for INVALID_MAX_EXTRA_BIN_ARRAYS", () => {
      const error = new DlmmSdkError(
        SdkErrorCode.INVALID_MAX_EXTRA_BIN_ARRAYS,
        "maxExtraBinArrays must be a value between 0 and 3"
      );

      expect(error.code).toBe(SdkErrorCode.INVALID_MAX_EXTRA_BIN_ARRAYS);
      expect(error.message).toBe(
        "maxExtraBinArrays must be a value between 0 and 3"
      );
    });
  });

  describe("static is()", () => {
    test("should return true for matching SDK error code", () => {
      const error = new DlmmSdkError(
        SdkErrorCode.SWAP_QUOTE_INSUFFICIENT_LIQUIDITY
      );

      expect(
        DlmmSdkError.is(error, SdkErrorCode.SWAP_QUOTE_INSUFFICIENT_LIQUIDITY)
      ).toBe(true);
    });

    test("should return false for non-matching SDK error code", () => {
      const error = new DlmmSdkError(
        SdkErrorCode.SWAP_QUOTE_INSUFFICIENT_LIQUIDITY
      );

      expect(
        DlmmSdkError.is(error, SdkErrorCode.INVALID_MAX_EXTRA_BIN_ARRAYS)
      ).toBe(false);
    });

    test("should return false for generic Error", () => {
      const error = new Error("some error");

      expect(
        DlmmSdkError.is(error, SdkErrorCode.SWAP_QUOTE_INSUFFICIENT_LIQUIDITY)
      ).toBe(false);
    });

    test("should return false for null and undefined", () => {
      expect(
        DlmmSdkError.is(null, SdkErrorCode.SWAP_QUOTE_INSUFFICIENT_LIQUIDITY)
      ).toBe(false);
      expect(
        DlmmSdkError.is(
          undefined,
          SdkErrorCode.SWAP_QUOTE_INSUFFICIENT_LIQUIDITY
        )
      ).toBe(false);
    });
  });
});
