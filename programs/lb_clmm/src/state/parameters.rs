use crate::constants::{BASIS_POINT_MAX, MAX_BASE_FACTOR_STEP, MAX_PROTOCOL_SHARE};
use crate::instructions::update_fee_parameters::FeeParameter;
use crate::{errors::LBError, math::safe_math::SafeMath};
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

impl StaticParameters {
    pub fn update(&mut self, parameter: &FeeParameter) -> Result<()> {
        let base_factor_delta = if parameter.base_factor > self.base_factor {
            parameter.base_factor.safe_sub(self.base_factor)?
        } else {
            self.base_factor.safe_sub(parameter.base_factor)?
        };

        // Fee increment / decrement must <= 100% of the current fee rate
        require!(
            base_factor_delta <= self.base_factor,
            LBError::ExcessiveFeeUpdate
        );

        // Fee increment / decrement must <= 100 bps, 1%
        require!(
            base_factor_delta <= MAX_BASE_FACTOR_STEP,
            LBError::ExcessiveFeeUpdate
        );

        // During quote it already capped. Extra safety check.
        require!(
            parameter.protocol_share <= MAX_PROTOCOL_SHARE,
            LBError::ExcessiveFeeUpdate
        );

        self.protocol_share = parameter.protocol_share;
        self.base_factor = parameter.base_factor;

        Ok(())
    }

    #[inline(always)]
    #[cfg(not(feature = "localnet"))]
    pub fn get_filter_period(&self) -> u16 {
        self.filter_period
    }

    #[inline(always)]
    #[cfg(feature = "localnet")]
    pub fn get_filter_period(&self) -> u16 {
        5
    }

    #[inline(always)]
    #[cfg(not(feature = "localnet"))]
    pub fn get_decay_period(&self) -> u16 {
        self.decay_period
    }

    #[inline(always)]
    #[cfg(feature = "localnet")]
    pub fn get_decay_period(&self) -> u16 {
        10
    }
}

impl Default for StaticParameters {
    /// These value are references from Trader Joe
    fn default() -> Self {
        Self {
            base_factor: 10_000,
            filter_period: 30,
            decay_period: 600,
            reduction_factor: 500,
            variable_fee_control: 40_000,
            protocol_share: 1_000,
            max_volatility_accumulator: 350_000, // Capped at 35 bin crossed. 350_000 / 10_000 (bps unit) = 35 delta bin
            _padding: [0u8; 6],
            max_bin_id: i32::MAX,
            min_bin_id: i32::MIN,
        }
    }
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

impl VariableParameters {
    /// volatility_accumulator = min(volatility_reference + num_of_bin_crossed, max_volatility_accumulator)
    pub fn update_volatility_accumulator(
        &mut self,
        active_id: i32,
        static_params: &StaticParameters,
    ) -> Result<()> {
        // Upscale to prevent overflow caused by swapping from left most bin to right most bin.
        let delta_id = i64::from(self.index_reference)
            .safe_sub(active_id.into())?
            .unsigned_abs();

        let volatility_accumulator = u64::from(self.volatility_reference)
            .safe_add(delta_id.safe_mul(BASIS_POINT_MAX as u64)?)?;

        self.volatility_accumulator = std::cmp::min(
            volatility_accumulator,
            static_params.max_volatility_accumulator.into(),
        )
        .try_into()
        .map_err(|_| LBError::TypeCastFailed)?;

        Ok(())
    }

    /// Update id, and volatility reference
    pub fn update_references(
        &mut self,
        active_id: i32,
        current_timestamp: i64,
        static_params: &StaticParameters,
    ) -> Result<()> {
        let elapsed = current_timestamp.safe_sub(self.last_update_timestamp)?;

        // Not high frequency trade
        if elapsed >= static_params.get_filter_period() as i64 {
            // Update active id of last transaction
            self.index_reference = active_id;
            // filter period < t < decay_period. Decay time window.
            if elapsed < static_params.get_decay_period() as i64 {
                let volatility_reference = self
                    .volatility_accumulator
                    .safe_mul(static_params.reduction_factor as u32)?
                    .safe_div(BASIS_POINT_MAX as u32)?;

                self.volatility_reference = volatility_reference;
            }
            // Out of decay time window
            else {
                self.volatility_reference = 0;
            }
        }

        // self.last_update_timestamp = current_timestamp;

        Ok(())
    }

    pub fn update_volatility_parameter(
        &mut self,
        active_id: i32,
        current_timestamp: i64,
        static_params: &StaticParameters,
    ) -> Result<()> {
        self.update_references(active_id, current_timestamp, static_params)?;
        self.update_volatility_accumulator(active_id, static_params)
    }
}

#[cfg(test)]
mod parameter_tests {
    use super::*;
    use crate::constants::tests::*;
    use crate::state::lb_pair::{LbPair, PairType};
    use crate::state::PairStatus;
    use proptest::proptest;
    proptest! {
        #[test]
        fn test_update_volatility_accumulator_range(
            max_volatility_accumulator in u32::MIN..=u32::MAX,
            index_reference in i32::MIN..=i32::MAX,
            volatility_accumulator in u32::MIN..=u32::MAX,
            volatility_reference in u32::MIN..=u32::MAX,
        ) {
            for bin_step in PRESET_BIN_STEP {
                let mut params = get_preset(bin_step).unwrap();
                params.max_volatility_accumulator = max_volatility_accumulator;

                let mut v_params = VariableParameters::default();
                v_params.index_reference = index_reference;
                v_params.volatility_accumulator = volatility_accumulator;
                v_params.volatility_reference = volatility_reference;

                assert!(v_params
                    .update_volatility_accumulator(i32::MAX, &params)
                    .is_ok());
            }

        }
    }

    #[test]
    fn test_total_fee_volatile() {
        let mut active_id = 1000;
        let bin_step = 10;
        let mut last_update_timestamp = 1_000_000;

        let mut lb_pair = LbPair::default();
        let pair_type = PairType::Permissionless;

        lb_pair
            .initialize(
                0,
                active_id,
                bin_step,
                Pubkey::default(),
                Pubkey::default(),
                Pubkey::default(),
                Pubkey::default(),
                Pubkey::default(),
                get_preset(bin_step).unwrap(),
                pair_type,
                PairStatus::Enabled.into(),
                Pubkey::default(),
                0,
                Pubkey::default(),
            )
            .unwrap();

        let total_fee: u128 = lb_pair.get_total_fee().unwrap().try_into().unwrap();
        let fee_rate = total_fee as f64 / 10f64.powi(16);
        println!("fee_rate {}", fee_rate);

        lb_pair
            .v_parameters
            .update_references(active_id, last_update_timestamp, &lb_pair.parameters)
            .unwrap();

        active_id += 1;

        lb_pair
            .v_parameters
            .update_volatility_accumulator(active_id, &lb_pair.parameters)
            .unwrap();

        let total_fee: u128 = lb_pair.get_total_fee().unwrap().try_into().unwrap();
        let fee_rate = total_fee as f64 / 10f64.powi(16);
        println!("fee_rate {}", fee_rate);

        // Decay window
        last_update_timestamp += 30;

        lb_pair
            .v_parameters
            .update_references(active_id, last_update_timestamp, &lb_pair.parameters)
            .unwrap();

        lb_pair
            .v_parameters
            .update_volatility_accumulator(active_id, &lb_pair.parameters)
            .unwrap();

        let total_fee: u128 = lb_pair.get_total_fee().unwrap().try_into().unwrap();
        let fee_rate = total_fee as f64 / 10f64.powi(16);
        println!("fee_rate {}", fee_rate);
    }

    #[test]
    fn test_update_volatility_accumulator() {
        let mut active_id = 1000;
        let bin_step = 10;
        let mut last_update_timestamp = 1_000_000;

        let static_param = get_preset(bin_step).unwrap();

        let mut var_param = VariableParameters {
            last_update_timestamp,
            index_reference: active_id,
            ..Default::default()
        };

        var_param
            .update_references(active_id, last_update_timestamp, &static_param)
            .unwrap();

        active_id += 5;

        var_param
            .update_volatility_accumulator(active_id, &static_param)
            .unwrap();

        println!("{:?}", var_param);
        // High freq window
        for _ in 0..1000 {
            last_update_timestamp += 20;

            var_param
                .update_references(active_id, last_update_timestamp, &static_param)
                .unwrap();

            var_param
                .update_volatility_accumulator(active_id, &static_param)
                .unwrap();
        }

        println!("{:?}", var_param);

        // Decay window
        last_update_timestamp += 30;

        var_param
            .update_references(active_id, last_update_timestamp, &static_param)
            .unwrap();

        active_id += 2;

        var_param
            .update_volatility_accumulator(active_id, &static_param)
            .unwrap();
        println!("{:?}", var_param);

        // High freq
        last_update_timestamp += 10;

        var_param
            .update_references(active_id, last_update_timestamp, &static_param)
            .unwrap();

        var_param
            .update_volatility_accumulator(active_id, &static_param)
            .unwrap();
        println!("{:?}", var_param);

        // Decay window
        last_update_timestamp += 30;

        var_param
            .update_references(active_id, last_update_timestamp, &static_param)
            .unwrap();

        var_param
            .update_volatility_accumulator(active_id, &static_param)
            .unwrap();
        println!("{:?}", var_param);

        // High freq
        last_update_timestamp += 10;

        active_id += 2;

        var_param
            .update_references(active_id, last_update_timestamp, &static_param)
            .unwrap();

        var_param
            .update_volatility_accumulator(active_id, &static_param)
            .unwrap();

        println!("{:?}", var_param);
    }
}
