use anchor_lang::prelude::*;

#[zero_copy]
#[derive(InitSpace, Debug)]
/// Parameter that set by the protocol
pub struct StaticParameters {
    /// Used for base fee calculation. base_fee_rate = base_factor * bin_step
    pub base_factor: u16,
    /// Filter period determine high frequency trading time window.
    pub filter_period: u16,
    /// Decay period determine when the volatile fee start decay / decrease.
    pub decay_period: u16,
    /// Reduction factor controls the volatile fee rate decrement rate.
    pub reduction_factor: u16,
    /// Used to scale the variable fee component depending on the dynamic of the market
    pub variable_fee_control: u32,
    /// Maximum number of bin crossed can be accumulated. Used to cap volatile fee rate.
    pub max_volatility_accumulator: u32,
    /// Min bin id supported by the pool based on the configured bin step.
    pub min_bin_id: i32,
    /// Max bin id supported by the pool based on the configured bin step.
    pub max_bin_id: i32,
    /// Portion of swap fees retained by the protocol by controlling protocol_share parameter. protocol_swap_fee = protocol_share * total_swap_fee
    pub protocol_share: u16,
    /// Padding for bytemuck safe alignment
    pub _padding: [u8; 6],
}

#[zero_copy]
#[derive(InitSpace, Default, Debug)]
/// Parameters that changes based on dynamic of the market
pub struct VariableParameters {
    /// Volatility accumulator measure the number of bin crossed since reference bin ID. Normally (without filter period taken into consideration), reference bin ID is the active bin of last swap.
    /// It affects the variable fee rate
    pub volatility_accumulator: u32,
    /// Volatility reference is decayed volatility accumulator. It is always <= volatility_accumulator
    pub volatility_reference: u32,
    /// Active bin id of last swap.
    pub index_reference: i32,
    /// Padding for bytemuck safe alignment
    pub _padding: [u8; 4],
    /// Last timestamp the variable parameters was updated
    pub last_update_timestamp: i64,
    /// Padding for bytemuck safe alignment
    pub _padding_1: [u8; 8],
}
