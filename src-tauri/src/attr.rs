use crate::error::{AppError, Result};
use aws_sdk_dynamodb::primitives::Blob;
use aws_sdk_dynamodb::types::AttributeValue;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

const DDB_TYPE_KEYS: &[&str] = &["S", "N", "B", "BOOL", "NULL", "L", "M", "SS", "NS", "BS"];

pub fn is_ddb_typed_object(obj: &Map<String, Value>) -> bool {
    obj.len() == 1 && obj.keys().next().is_some_and(|k| DDB_TYPE_KEYS.contains(&k.as_str()))
}

pub fn av_to_ddb_json(av: &AttributeValue) -> Value {
    match av {
        AttributeValue::S(s) => json!({ "S": s }),
        AttributeValue::N(n) => json!({ "N": n }),
        AttributeValue::Bool(b) => json!({ "BOOL": b }),
        AttributeValue::Null(_) => json!({ "NULL": true }),
        AttributeValue::B(b) => json!({ "B": BASE64.encode(b.as_ref()) }),
        AttributeValue::Ss(ss) => json!({ "SS": ss }),
        AttributeValue::Ns(ns) => json!({ "NS": ns }),
        AttributeValue::Bs(bs) => {
            json!({ "BS": bs.iter().map(|b| BASE64.encode(b.as_ref())).collect::<Vec<_>>() })
        }
        AttributeValue::L(list) => json!({ "L": list.iter().map(av_to_ddb_json).collect::<Vec<_>>() }),
        AttributeValue::M(map) => {
            let mut obj = Map::new();
            for (k, v) in map {
                obj.insert(k.clone(), av_to_ddb_json(v));
            }
            json!({ "M": obj })
        }
        _ => json!({ "NULL": true }),
    }
}

pub fn av_to_document(av: &AttributeValue) -> Value {
    match av {
        AttributeValue::S(s) => Value::String(s.clone()),
        AttributeValue::N(n) => parse_number(n),
        AttributeValue::Bool(b) => Value::Bool(*b),
        AttributeValue::Null(_) => Value::Null,
        AttributeValue::B(b) => Value::String(BASE64.encode(b.as_ref())),
        AttributeValue::Ss(ss) => json!(ss),
        AttributeValue::Ns(ns) => json!(ns.iter().map(|n| parse_number(n)).collect::<Vec<_>>()),
        AttributeValue::Bs(bs) => {
            json!(bs.iter().map(|b| BASE64.encode(b.as_ref())).collect::<Vec<_>>())
        }
        AttributeValue::L(list) => Value::Array(list.iter().map(av_to_document).collect()),
        AttributeValue::M(map) => {
            let mut obj = Map::new();
            for (k, v) in map {
                obj.insert(k.clone(), av_to_document(v));
            }
            Value::Object(obj)
        }
        _ => Value::Null,
    }
}

fn parse_number(n: &str) -> Value {
    if let Ok(i) = n.parse::<i64>() {
        json!(i)
    } else if let Ok(f) = n.parse::<f64>() {
        json!(f)
    } else {
        Value::String(n.to_string())
    }
}

pub fn item_to_ddb_json(item: &HashMap<String, AttributeValue>) -> Value {
    let mut obj = Map::new();
    for (k, v) in item {
        obj.insert(k.clone(), av_to_ddb_json(v));
    }
    Value::Object(obj)
}

pub fn item_to_document(item: &HashMap<String, AttributeValue>) -> Value {
    let mut obj = Map::new();
    for (k, v) in item {
        obj.insert(k.clone(), av_to_document(v));
    }
    Value::Object(obj)
}

pub fn ddb_json_to_av(value: &Value) -> Result<AttributeValue> {
    let obj = value
        .as_object()
        .ok_or_else(|| AppError::msg("DynamoDB JSON value must be an object with a type key"))?;
    if !is_ddb_typed_object(obj) {
        return Err(AppError::msg(
            "DynamoDB JSON must be a single-key object (S, N, BOOL, NULL, L, M, SS, NS, B, BS)",
        ));
    }
    let (key, inner) = obj.iter().next().unwrap();
    match key.as_str() {
        "S" => Ok(AttributeValue::S(as_string(inner))),
        "N" => Ok(AttributeValue::N(as_string(inner))),
        "BOOL" => Ok(AttributeValue::Bool(as_bool(inner))),
        "NULL" => Ok(AttributeValue::Null(true)),
        "B" => Ok(AttributeValue::B(decode_blob(&as_string(inner))?)),
        "SS" => Ok(AttributeValue::Ss(as_string_array(inner))),
        "NS" => Ok(AttributeValue::Ns(as_string_array(inner))),
        "BS" => {
            let blobs = as_string_array(inner)
                .into_iter()
                .map(|s| decode_blob(&s))
                .collect::<Result<Vec<_>>>()?;
            Ok(AttributeValue::Bs(blobs))
        }
        "L" => {
            let list = inner
                .as_array()
                .ok_or_else(|| AppError::msg("L must be an array"))?
                .iter()
                .map(ddb_json_to_av)
                .collect::<Result<Vec<_>>>()?;
            Ok(AttributeValue::L(list))
        }
        "M" => {
            let map = inner
                .as_object()
                .ok_or_else(|| AppError::msg("M must be an object"))?;
            let mut out = HashMap::new();
            for (k, v) in map {
                out.insert(k.clone(), ddb_json_to_av(v)?);
            }
            Ok(AttributeValue::M(out))
        }
        other => Err(AppError::msg(format!("Unknown DynamoDB type {other}"))),
    }
}

pub fn document_to_av(value: &Value) -> Result<AttributeValue> {
    match value {
        Value::String(s) => Ok(AttributeValue::S(s.clone())),
        Value::Number(n) => Ok(AttributeValue::N(n.to_string())),
        Value::Bool(b) => Ok(AttributeValue::Bool(*b)),
        Value::Null => Ok(AttributeValue::Null(true)),
        Value::Array(arr) => {
            let list = arr.iter().map(document_to_av).collect::<Result<Vec<_>>>()?;
            Ok(AttributeValue::L(list))
        }
        Value::Object(map) => {
            if is_ddb_typed_object(map) {
                return ddb_json_to_av(value);
            }
            let mut out = HashMap::new();
            for (k, v) in map {
                out.insert(k.clone(), document_to_av(v)?);
            }
            Ok(AttributeValue::M(out))
        }
    }
}

pub fn json_to_item(value: &Value, format: &str) -> Result<HashMap<String, AttributeValue>> {
    let obj = value
        .as_object()
        .ok_or_else(|| AppError::msg("Item must be a JSON object"))?;
    let mut item = HashMap::new();
    for (k, v) in obj {
        let av = if format == "ddb" {
            ddb_json_to_av(v)?
        } else {
            document_to_av(v)?
        };
        item.insert(k.clone(), av);
    }
    Ok(item)
}

pub fn json_map_to_item_ddb(value: &Value) -> Result<HashMap<String, AttributeValue>> {
    let obj = value
        .as_object()
        .ok_or_else(|| AppError::msg("Key must be a JSON object"))?;
    let mut item = HashMap::new();
    for (k, v) in obj {
        let av = if v.as_object().is_some_and(is_ddb_typed_object) {
            ddb_json_to_av(v)?
        } else {
            document_to_av(v)?
        };
        item.insert(k.clone(), av);
    }
    Ok(item)
}

pub fn typed_value(value: &Value, ty: Option<&str>) -> Result<AttributeValue> {
    match ty.map(|t| t.to_ascii_uppercase()) {
        Some(t) if t == "S" => Ok(AttributeValue::S(as_string(value))),
        Some(t) if t == "N" => Ok(AttributeValue::N(as_string(value))),
        Some(t) if t == "BOOL" => Ok(AttributeValue::Bool(as_bool(value))),
        Some(t) if t == "NULL" => Ok(AttributeValue::Null(true)),
        Some(t) if t == "B" => Ok(AttributeValue::B(decode_blob(&as_string(value))?)),
        _ => document_to_av(value),
    }
}

fn as_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn as_bool(value: &Value) -> bool {
    match value {
        Value::Bool(b) => *b,
        Value::String(s) => matches!(s.to_ascii_lowercase().as_str(), "true" | "1" | "yes"),
        Value::Number(n) => n.as_i64().unwrap_or(0) != 0,
        _ => false,
    }
}

fn as_string_array(value: &Value) -> Vec<String> {
    match value {
        Value::Array(arr) => arr.iter().map(as_string).collect(),
        other => vec![as_string(other)],
    }
}

fn decode_blob(s: &str) -> Result<Blob> {
    let bytes = BASE64
        .decode(s.trim())
        .map_err(|e| AppError::msg(format!("Invalid base64: {e}")))?;
    Ok(Blob::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn document_roundtrip_scalars() {
        let av = document_to_av(&json!("hello")).unwrap();
        assert_eq!(av_to_document(&av), json!("hello"));
        let av = document_to_av(&json!(42)).unwrap();
        assert_eq!(av_to_document(&av), json!(42));
    }

    #[test]
    fn ddb_json_map() {
        let v = json!({ "S": "abc" });
        let av = ddb_json_to_av(&v).unwrap();
        assert_eq!(av_to_ddb_json(&av), v);
    }
}
