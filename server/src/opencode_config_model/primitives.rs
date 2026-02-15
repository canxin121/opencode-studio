use std::fmt;

use serde::de::{self, Visitor};
use serde::ser::Serializer;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrueOnly;

impl Serialize for TrueOnly {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_bool(true)
    }
}

impl<'de> Deserialize<'de> for TrueOnly {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct TrueOnlyVisitor;

        impl<'de> Visitor<'de> for TrueOnlyVisitor {
            type Value = TrueOnly;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("true")
            }

            fn visit_bool<E>(self, value: bool) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                if !value {
                    return Err(E::custom("expected true"));
                }
                Ok(TrueOnly)
            }
        }

        deserializer.deserialize_any(TrueOnlyVisitor)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FalseOnly;

impl Serialize for FalseOnly {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_bool(false)
    }
}

impl<'de> Deserialize<'de> for FalseOnly {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct FalseOnlyVisitor;

        impl<'de> Visitor<'de> for FalseOnlyVisitor {
            type Value = FalseOnly;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("false")
            }

            fn visit_bool<E>(self, value: bool) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                if value {
                    return Err(E::custom("expected false"));
                }
                Ok(FalseOnly)
            }
        }

        deserializer.deserialize_any(FalseOnlyVisitor)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct PositiveInt(pub u64);

impl Serialize for PositiveInt {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_u64(self.0)
    }
}

impl<'de> Deserialize<'de> for PositiveInt {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct PositiveIntVisitor;

        impl<'de> Visitor<'de> for PositiveIntVisitor {
            type Value = PositiveInt;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a positive integer")
            }

            fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                if value == 0 {
                    return Err(E::custom("expected a positive integer"));
                }
                Ok(PositiveInt(value))
            }

            fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                if value <= 0 {
                    return Err(E::custom("expected a positive integer"));
                }
                Ok(PositiveInt(value as u64))
            }

            fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                if !value.is_finite() || value <= 0.0 || value.fract() != 0.0 {
                    return Err(E::custom("expected a positive integer"));
                }
                Ok(PositiveInt(value as u64))
            }
        }

        deserializer.deserialize_any(PositiveIntVisitor)
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScrollSpeed(pub f64);

impl Serialize for ScrollSpeed {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_f64(self.0)
    }
}

impl<'de> Deserialize<'de> for ScrollSpeed {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct ScrollSpeedVisitor;

        impl<'de> Visitor<'de> for ScrollSpeedVisitor {
            type Value = ScrollSpeed;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a number >= 0.001")
            }

            fn visit_u64<E>(self, value: u64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                let value = value as f64;
                if value < 0.001 {
                    return Err(E::custom("expected a number >= 0.001"));
                }
                Ok(ScrollSpeed(value))
            }

            fn visit_i64<E>(self, value: i64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                let value = value as f64;
                if value < 0.001 {
                    return Err(E::custom("expected a number >= 0.001"));
                }
                Ok(ScrollSpeed(value))
            }

            fn visit_f64<E>(self, value: f64) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                if !value.is_finite() || value < 0.001 {
                    return Err(E::custom("expected a number >= 0.001"));
                }
                Ok(ScrollSpeed(value))
            }
        }

        deserializer.deserialize_any(ScrollSpeedVisitor)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HexColor(pub String);

impl Serialize for HexColor {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for HexColor {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct HexColorVisitor;

        impl<'de> Visitor<'de> for HexColorVisitor {
            type Value = HexColor;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a hex color in the form #RRGGBB")
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: de::Error,
            {
                if value.len() != 7 || !value.starts_with('#') {
                    return Err(E::custom("expected a hex color in the form #RRGGBB"));
                }
                if !value[1..].chars().all(|ch| ch.is_ascii_hexdigit()) {
                    return Err(E::custom("expected a hex color in the form #RRGGBB"));
                }
                Ok(HexColor(value.to_string()))
            }
        }

        deserializer.deserialize_str(HexColorVisitor)
    }
}
