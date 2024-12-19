use dlmm_interface::ActivationType;
use std::ops::Deref;

pub struct ActivationTypeWrapper(ActivationType);

impl Deref for ActivationTypeWrapper {
    type Target = ActivationType;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl TryFrom<u8> for ActivationTypeWrapper {
    type Error = anyhow::Error;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(ActivationTypeWrapper(ActivationType::Slot)),
            1 => Ok(ActivationTypeWrapper(ActivationType::Timestamp)),
            _ => Err(anyhow::anyhow!("Invalid ActivationType value: {}", value)),
        }
    }
}
