
import Decimal from "decimal.js";
import { BN } from "@coral-xyz/anchor";
import { getPriceOfBinByBinId } from "./weight";

export function toAmountBidSide(
    activeId: number,
    totalAmount: BN,
    distributions: { binId: number; weight: number }[],
): {
    binId: number,
    amount: BN
}[] {
    // get sum of weight
    const totalWeight = distributions.reduce(function (sum, el) {
        return el.binId > activeId ? sum : sum.add(el.weight); // skip all ask side
    }, new Decimal(0));

    if (totalWeight.cmp(new Decimal(0)) != 1) {
        throw Error("Invalid parameteres");
    }
    return distributions.map((bin) => {
        if (bin.binId > activeId) {
            return {
                binId: bin.binId,
                amount: new BN(0),
            };
        } else {
            return {
                binId: bin.binId,
                amount: new BN(new Decimal(totalAmount.toString())
                    .mul(new Decimal(bin.weight).div(totalWeight))
                    .floor().toString()),
            };
        }
    });
}

export function toAmountAskSide(activeId: number,
    binStep: number,
    totalAmount: BN,
    distributions: { binId: number; weight: number }[]): {
        binId: number,
        amount: BN
    }[] {
    // get sum of weight
    const totalWeight: Decimal = distributions.reduce(function (sum, el) {
        if (el.binId < activeId) {
            return sum;
        } else {
            const price = getPriceOfBinByBinId(el.binId, binStep);
            const weightPerPrice = new Decimal(el.weight).div(price);
            return sum.add(weightPerPrice);
        }
    }, new Decimal(0));

    if (totalWeight.cmp(new Decimal(0)) != 1) {
        throw Error("Invalid parameteres");
    }

    return distributions.map((bin) => {
        if (bin.binId < activeId) {
            return {
                binId: bin.binId,
                amount: new BN(0),
            };
        } else {
            const price = getPriceOfBinByBinId(bin.binId, binStep);
            const weightPerPrice = new Decimal(bin.weight).div(price);
            return {
                binId: bin.binId,
                amount: new BN(new Decimal(totalAmount.toString()).mul(weightPerPrice).div(totalWeight).floor().toString()),
            };
        }
    })
}

export function toAmountBothSide(
    activeId: number,
    binStep: number,
    amountX: BN,
    amountY: BN,
    amountXInActiveBin: BN,
    amountYInActiveBin: BN,
    distributions: { binId: number; weight: number }[]): {
        binId: number,
        amountX: BN,
        amountY: BN
    }[] {

    const activeBins = distributions.filter((element) => {
        return element.binId === activeId;
    });

    if (activeBins.length === 1) {
        const p0 = getPriceOfBinByBinId(activeId, binStep);
        let wx0 = new Decimal(0);
        let wy0 = new Decimal(0);
        const activeBin = activeBins[0];
        if (amountXInActiveBin.isZero() && amountYInActiveBin.isZero()) {
            wx0 = new Decimal(activeBin.weight).div(p0.mul(new Decimal(2)));
            wy0 = new Decimal(activeBin.weight).div(new Decimal(2));
        } else {
            let amountXInActiveBinDec = new Decimal(amountXInActiveBin.toString());
            let amountYInActiveBinDec = new Decimal(amountYInActiveBin.toString());

            if (!amountXInActiveBin.isZero()) {
                wx0 = new Decimal(activeBin.weight).div(
                    p0.add(amountYInActiveBinDec.div(amountXInActiveBinDec))
                );
            }
            if (!amountYInActiveBin.isZero()) {
                wy0 = new Decimal(activeBin.weight).div(
                    new Decimal(1).add(
                        p0.mul(amountXInActiveBinDec).div(amountYInActiveBinDec)
                    )
                );
            }
        }

        let totalWeightX = wx0;
        let totalWeightY = wy0;
        distributions.forEach((element) => {
            if (element.binId < activeId) {
                totalWeightY = totalWeightY.add(new Decimal(element.weight));
            }
            if (element.binId > activeId) {
                let price = getPriceOfBinByBinId(element.binId, binStep);
                let weighPerPrice = new Decimal(element.weight).div(price);
                totalWeightX = totalWeightX.add(weighPerPrice);
            }
        });
        const kx = new Decimal(amountX.toNumber()).div(totalWeightX);
        const ky = new Decimal(amountY.toNumber()).div(totalWeightY);
        let k = (kx.lessThan(ky) ? kx : ky);
        return distributions.map((bin) => {
            if (bin.binId < activeId) {
                const amount = k.mul(new Decimal(bin.weight));
                return {
                    binId: bin.binId,
                    amountX: new BN(0),
                    amountY: new BN(Math.floor(amount.toNumber())),
                };
            }
            if (bin.binId > activeId) {
                const price = getPriceOfBinByBinId(bin.binId, binStep);
                const weighPerPrice = new Decimal(bin.weight).div(price);
                const amount = k.mul(weighPerPrice);
                return {
                    binId: bin.binId,
                    amountX: new BN(Math.floor(amount.toNumber())),
                    amountY: new BN(0),
                };
            }

            const amountXActiveBin = k.mul(wx0);
            const amountYActiveBin = k.mul(wy0);
            return {
                binId: bin.binId,
                amountX: new BN(Math.floor(amountXActiveBin.toNumber())),
                amountY: new BN(Math.floor(amountYActiveBin.toNumber())),
            };
        });
    } else {
        let totalWeightX = new Decimal(0);
        let totalWeightY = new Decimal(0);
        distributions.forEach((element) => {
            if (element.binId < activeId) {
                totalWeightY = totalWeightY.add(new Decimal(element.weight));
            } else {
                let price = getPriceOfBinByBinId(element.binId, binStep);
                let weighPerPrice = new Decimal(element.weight).div(price);
                totalWeightX = totalWeightX.add(weighPerPrice);
            }
        });

        let kx = new Decimal(amountX.toNumber()).div(totalWeightX);
        let ky = new Decimal(amountY.toNumber()).div(totalWeightY);
        let k = kx.lessThan(ky) ? kx : ky;

        return distributions.map((bin) => {
            if (bin.binId < activeId) {
                const amount = k.mul(new Decimal(bin.weight));
                return {
                    binId: bin.binId,
                    amountX: new BN(0),
                    amountY: new BN(Math.floor(amount.toNumber())),
                };
            } else {
                let price = getPriceOfBinByBinId(bin.binId, binStep);
                let weighPerPrice = new Decimal(bin.weight).div(price);
                const amount = k.mul(weighPerPrice);
                return {
                    binId: bin.binId,
                    amountX: new BN(Math.floor(amount.toNumber())),
                    amountY: new BN(0),
                };
            }
        });
    }
}


export function autoFillYByWeight(
    activeId: number,
    binStep: number,
    amountX: BN,
    amountXInActiveBin: BN,
    amountYInActiveBin: BN,
    distributions: { binId: number; weight: number }[]): BN {
    const activeBins = distributions.filter((element) => {
        return element.binId === activeId;
    });

    if (activeBins.length === 1) {
        const p0 = getPriceOfBinByBinId(activeId, binStep);
        let wx0 = new Decimal(0);
        let wy0 = new Decimal(0);
        const activeBin = activeBins[0];
        if (amountXInActiveBin.isZero() && amountYInActiveBin.isZero()) {
            wx0 = new Decimal(activeBin.weight).div(p0.mul(new Decimal(2)));
            wy0 = new Decimal(activeBin.weight).div(new Decimal(2));
        } else {
            let amountXInActiveBinDec = new Decimal(amountXInActiveBin.toString());
            let amountYInActiveBinDec = new Decimal(amountYInActiveBin.toString());

            if (!amountXInActiveBin.isZero()) {
                wx0 = new Decimal(activeBin.weight).div(
                    p0.add(amountYInActiveBinDec.div(amountXInActiveBinDec))
                );
            }
            if (!amountYInActiveBin.isZero()) {
                wy0 = new Decimal(activeBin.weight).div(
                    new Decimal(1).add(
                        p0.mul(amountXInActiveBinDec).div(amountYInActiveBinDec)
                    )
                );
            }
        }

        let totalWeightX = wx0;
        let totalWeightY = wy0;
        distributions.forEach((element) => {
            if (element.binId < activeId) {
                totalWeightY = totalWeightY.add(new Decimal(element.weight));
            }
            if (element.binId > activeId) {
                const price = getPriceOfBinByBinId(element.binId, binStep);
                const weighPerPrice = new Decimal(element.weight).div(price);
                totalWeightX = totalWeightX.add(weighPerPrice);
            }
        });
        const kx = totalWeightX.isZero() ? new Decimal(1) : new Decimal(amountX.toString()).div(totalWeightX);
        const amountY = kx.mul(totalWeightY);
        return new BN(amountY.floor().toString())
    } else {
        let totalWeightX = new Decimal(0);
        let totalWeightY = new Decimal(0);
        distributions.forEach((element) => {
            if (element.binId < activeId) {
                totalWeightY = totalWeightY.add(new Decimal(element.weight));
            } else {
                const price = getPriceOfBinByBinId(element.binId, binStep);
                const weighPerPrice = new Decimal(element.weight).div(price);
                totalWeightX = totalWeightX.add(weighPerPrice);
            }
        });
        const kx = totalWeightX.isZero() ? new Decimal(1) : new Decimal(amountX.toString()).div(totalWeightX);
        const amountY = kx.mul(totalWeightY);
        return new BN(amountY.floor().toString())
    }
}


export function autoFillXByWeight(
    activeId: number,
    binStep: number,
    amountY: BN,
    amountXInActiveBin: BN,
    amountYInActiveBin: BN,
    distributions: { binId: number; weight: number }[]): BN {
    const activeBins = distributions.filter((element) => {
        return element.binId === activeId;
    });

    if (activeBins.length === 1) {
        const p0 = getPriceOfBinByBinId(activeId, binStep);
        let wx0 = new Decimal(0);
        let wy0 = new Decimal(0);
        const activeBin = activeBins[0];
        if (amountXInActiveBin.isZero() && amountYInActiveBin.isZero()) {
            wx0 = new Decimal(activeBin.weight).div(p0.mul(new Decimal(2)));
            wy0 = new Decimal(activeBin.weight).div(new Decimal(2));
        } else {
            let amountXInActiveBinDec = new Decimal(amountXInActiveBin.toString());
            let amountYInActiveBinDec = new Decimal(amountYInActiveBin.toString());

            if (!amountXInActiveBin.isZero()) {
                wx0 = new Decimal(activeBin.weight).div(
                    p0.add(amountYInActiveBinDec.div(amountXInActiveBinDec))
                );
            }
            if (!amountYInActiveBin.isZero()) {
                wy0 = new Decimal(activeBin.weight).div(
                    new Decimal(1).add(
                        p0.mul(amountXInActiveBinDec).div(amountYInActiveBinDec)
                    )
                );
            }
        }

        let totalWeightX = wx0;
        let totalWeightY = wy0;
        distributions.forEach((element) => {
            if (element.binId < activeId) {
                totalWeightY = totalWeightY.add(new Decimal(element.weight));
            }
            if (element.binId > activeId) {
                const price = getPriceOfBinByBinId(element.binId, binStep);
                const weighPerPrice = new Decimal(element.weight).div(price);
                totalWeightX = totalWeightX.add(weighPerPrice);
            }
        });
        const ky = totalWeightY.isZero() ? new Decimal(1) : new Decimal(amountY.toString()).div(totalWeightY);
        const amountX = ky.mul(totalWeightX);
        return new BN(amountX.floor().toString())
    } else {
        let totalWeightX = new Decimal(0);
        let totalWeightY = new Decimal(0);
        distributions.forEach((element) => {
            if (element.binId < activeId) {
                totalWeightY = totalWeightY.add(new Decimal(element.weight));
            } else {
                const price = getPriceOfBinByBinId(element.binId, binStep);
                const weighPerPrice = new Decimal(element.weight).div(price);
                totalWeightX = totalWeightX.add(weighPerPrice);
            }
        });
        const ky = totalWeightY.isZero() ? new Decimal(1) : new Decimal(amountY.toNumber()).div(totalWeightY);
        const amountX = ky.mul(totalWeightX);
        return new BN(amountX.floor().toString())
    }
}