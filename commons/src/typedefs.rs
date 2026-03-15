#[derive(Debug)]
pub struct SwapResult {
    /// Amount of token swap into the bin
    pub amount_in_with_fees: u64,
    /// Amount of token swap out from the bin
    pub amount_out: u64,
    /// Swap fee, includes protocol fee
    pub fee: u64,
    /// Part of fee
    pub protocol_fee_after_host_fee: u64,
    /// Part of protocol fee
    pub host_fee: u64,
    /// Indicate whether we reach exact out amount
    pub is_exact_out_amount: bool,
}

/// Result of a per-bin quote calculation (used internally by quote functions).
#[derive(Debug)]
pub struct BinQuoteResult {
    /// Amount of input consumed (includes trading fee when fee_on_input)
    pub amount_in: u64,
    /// Amount of output produced (excludes trading fee when fee_on_output)
    pub amount_out: u64,
    /// Total trading fee
    pub fee: u64,
    /// Protocol portion of the trading fee
    pub protocol_fee: u64,
}
