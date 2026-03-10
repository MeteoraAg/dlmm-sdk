import IDL from "./idl/idl.json";
import { AnchorError } from "@coral-xyz/anchor";
import { LBCLMM_PROGRAM_IDS } from "./constants";

type Codes = (typeof IDL.errors)[number]["code"];

// ProgramError error parser
export class DLMMError extends Error {
  public errorCode: number;
  public errorName: string;
  public errorMessage: string;

  constructor(error: object | Codes) {
    let _errorCode = 0;
    let _errorName = "Something went wrong";
    let _errorMessage = "Something went wrong";

    if (error instanceof Error) {
      const anchorError = AnchorError.parse(
        JSON.parse(JSON.stringify(error)).logs as string[]
      );

      if (
        anchorError?.program.toBase58() === LBCLMM_PROGRAM_IDS["mainnet-beta"]
      ) {
        _errorCode = anchorError.error.errorCode.number;
        _errorName = anchorError.error.errorCode.code;
        _errorMessage = anchorError.error.errorMessage;
      }
    } else {
      const idlError = IDL.errors.find((err) => err.code === error);

      if (idlError) {
        _errorCode = idlError.code;
        _errorName = idlError.name;
        _errorMessage = idlError.msg;
      }
    }

    super(_errorMessage);

    this.errorCode = _errorCode;
    this.errorName = _errorName;
    this.errorMessage = _errorMessage;
  }
}

// SDK error codes
export enum SdkErrorCode {
  SWAP_QUOTE_INSUFFICIENT_LIQUIDITY = "SWAP_QUOTE_INSUFFICIENT_LIQUIDITY",
  INVALID_MAX_EXTRA_BIN_ARRAYS = "INVALID_MAX_EXTRA_BIN_ARRAYS",
}

const SDK_ERROR_MESSAGES: Record<SdkErrorCode, string> = {
  [SdkErrorCode.SWAP_QUOTE_INSUFFICIENT_LIQUIDITY]:
  "Insufficient liquidity",
  [SdkErrorCode.INVALID_MAX_EXTRA_BIN_ARRAYS]:
  "Max extra bin arrays value is invalid"
}

export class DlmmSdkError extends Error {
  name: string;
  message: string;
  code: SdkErrorCode;

  constructor(code: SdkErrorCode, errorMessage?: string) {
    const message = errorMessage ?? SDK_ERROR_MESSAGES[code];
    super(message);
    this.name = SdkErrorCode[code];
    this.message = message;
    this.code = code;
  }

  // Type-safe error check for catch blocks
  static is(error: unknown, code: SdkErrorCode): error is DlmmSdkError {
    return error instanceof DlmmSdkError && error.code === code;
  }
}
