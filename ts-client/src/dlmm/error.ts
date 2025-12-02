import IDL from "./dlmm.json";
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

// SDK error
type ErrorName = | "SWAP_QUOTE_INSUFFICIENT_LIQUIDITY" | "INVALID_MAX_EXTRA_BIN_ARRAYS";

export class DlmmSdkError extends Error {
    name: ErrorName;
    message: string;

    constructor(name: ErrorName, message: string) {
        super();
        this.name = name;
        this.message = message;
    }
}

export class PoolExistsError extends Error {
    message: string;

    constructor(message: string="This pool already exists") {
        super();
        this.message = message;
    }
}

export class LBPairAccountNotFound extends Error {
    message: string;

    constructor(account: string|null=null, message: string|null=null) {
        super();
        if (typeof account === "string") {
            this.message = `LB Pair account ${account} not found`
        }
        else if (message !== null) {
            this.message = message;
        }

        else {
            this.message = "LB Pair account was not found"
        }
    }
}

export class LBPairStateNotFound extends Error {
    message: string;

    constructor(account: string|null=null, message: string|null=null) {
        super();
        if (typeof account === "string") {
            this.message = `LB Pair ${account} state not found`
        }
        else if (message !== null) {
            this.message = message;
        }

        else {
            this.message = "LB Pair state was not found"
        }
    }
}

export class NoMintForLBPair extends Error {
    message: string;

    constructor(account: string|null=null, message: string|null=null) {
        super();
        if (typeof account === "string") {
            this.message = `Mint account for LB Pair ${account} not found`
        }
        else if (message !== null) {
            this.message = message;
        }

        else {
            this.message = "Mint account for LB Pair not found"
        }
    }
}

export class NoReserveForLBPair extends Error {
    message: string;

    constructor(account: string|null=null, message: string|null=null) {
        super();
        if (typeof account === "string") {
            this.message = `Reserve account for LB Pair ${account} not found`
        }
        else if (message !== null) {
            this.message = message;
        }

        else {
            this.message = "Reserve account for LB Pair not found"
        }
    }
}

export class BinArrayAccountNotFound extends Error {
    message: string;

    constructor(account: string|null=null, message: string|null=null) {
        super();
        if (typeof account === "string") {
            this.message = `Bin Array account ${account} not found`
        }
        else if (message !== null) {
            this.message = message;
        }

        else {
            this.message = "Bin Array account not found"
        }
    }
}

export class ClockAccountNotFound extends Error {
    message: string;

    constructor(message: string="Clock account not found") {
        super();
        this.message = message;
    }
}

export class ErrorFetchingActiveBin extends Error {
    message: string;

    constructor(message: string="Error fetching active bin") {
        super();
        this.message = message;
    }
}

export class ErrorFetchingPositions extends Error {
    message: string;

    constructor(message: string="Error fetching positions") {
        super();
        this.message = message;
    }
}

export class PositionAccountNotFound extends Error {
    message: string;

    constructor(account: string|null=null, message: string|null=null) {
        super();
        if (typeof account === "string") {
            this.message = `Position account ${account} not found`
        }
        else if (message !== null) {
            this.message = message;
        }

        else {
            this.message = "Position account not found"
        }
    }
}

export class PositionOutOfRange extends Error {
    message: string;

    constructor(max_bin: number|null=null, message: string|null=null) {
        super();
        if (typeof max_bin === "number") {
            this.message = `Position must be within a range of 1 to ${max_bin} bins.`
        }
        else if (message !== null) {
            this.message = message;
        }

        else {
            this.message = "Position is out of range"
        }
    }
}

export class ZeroLiquidityBinsError extends Error {
    message: string;

    constructor(message: string="No liquidity to add: Cannot add liquidity to zero bins") {
        super();
        this.message = message;
    }
}

export class IllegalBinConfiguration extends Error {
    message: string;

    constructor(message: string="You have an illegal bin configuration. Please check that your bin IDs are in the correct order.") {
        super();
        this.message = message;
    }
}

export class CannotRemoveZeroLiquidity extends Error {
    message: string;

    constructor(message: string="No liquidity to remove") {
        super();
        this.message = message;
    }
}

export class CannotClaimZeroRewards extends Error {
    message: string;

    constructor(message: string="No LM reward to claim") {
        super();
        this.message = message;
    }
}

export class CannotClaimZeroFees extends Error {
    message: string;

    constructor(message: string="No fee to claim") {
        super();
        this.message = message;
    }
}

export class PriceOutOfRange extends Error {
    message: string;

    constructor(message: string="Your min/max price is out of range of the current price") {
        super();
        this.message = message;
    }
}

export class PriceRangeTooSmall extends Error {
    message: string;

    constructor(message: string="Price range too small") {
        super();
        this.message = message;
    }
}

export class SyncError extends Error {
    message: string;

    constructor(message: string="Unable to sync with market price due to bin with liquidity between current and " +
        "market price bin") {
        super();
        this.message = message;
    }
}

export class DiscontinuousBinId extends Error {
    message: string;

    constructor(message: string="Bin IDs must be continuous") {
        super();
        this.message = message;
    }
}
