use crate::*;

impl TryFrom<u8> for ActivationType {
    type Error = anyhow::Error;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            0 => Ok(ActivationType::Slot),
            1 => Ok(ActivationType::Timestamp),
            _ => Err(anyhow::anyhow!("Invalid ActivationType value: {}", value)),
        }
    }
}
