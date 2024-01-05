import { IDL } from './idl';
import { AnchorError, ProgramError } from '@coral-xyz/anchor';
import { LBCLMM_PROGRAM_IDS } from './constants';

type Codes = (typeof IDL.errors)[number]['code'];

class DLMMError extends Error {
  public errorCode: number;
  public errorName: string;
  public errorMessage: string;

  constructor(error: object | Codes) {
    let _errorCode = 0;
    let _errorName = 'Something went wrong';
    let _errorMessage = 'Something went wrong';

    if (error instanceof Error) {
      const anchorError = AnchorError.parse(JSON.parse(JSON.stringify(error)).logs as string[]);

      if (anchorError?.program.toBase58() === LBCLMM_PROGRAM_IDS['mainnet-beta']) {
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

export default DLMMError;
