use crate::attr::{
    item_to_ddb_json, item_to_document, json_map_to_item_ddb, json_to_item, typed_value,
};
use crate::error::{sdk_err, AppError, Result};
use aws_sdk_dynamodb::types::{
    AttributeDefinition, BackupTypeFilter, BillingMode, CreateGlobalSecondaryIndexAction,
    DeleteGlobalSecondaryIndexAction, GlobalSecondaryIndex, GlobalSecondaryIndexUpdate,
    KeySchemaElement, KeyType, LocalSecondaryIndex, Projection, ProjectionType,
    ProvisionedThroughput, ReturnConsumedCapacity, ScalarAttributeType, Select, StreamSpecification,
    StreamViewType, TimeToLiveSpecification,
};
use aws_sdk_dynamodb::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyAttr {
    pub name: String,
    #[serde(rename = "type")]
    pub attr_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexKey {
    pub name: String,
    pub key_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexInfo {
    pub name: String,
    pub kind: String,
    pub status: Option<String>,
    pub key_schema: Vec<IndexKey>,
    pub projection: Option<String>,
    pub non_key_attributes: Vec<String>,
    pub item_count: Option<i64>,
    pub size_bytes: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub status: Option<String>,
    pub arn: Option<String>,
    pub item_count: Option<i64>,
    pub table_size_bytes: Option<i64>,
    pub billing_mode: Option<String>,
    pub table_class: Option<String>,
    pub creation_date_time: Option<String>,
    pub deletion_protection: bool,
    pub attribute_definitions: Vec<KeyAttr>,
    pub key_schema: Vec<IndexKey>,
    pub gsis: Vec<IndexInfo>,
    pub lsis: Vec<IndexInfo>,
    pub stream_enabled: bool,
    pub stream_view_type: Option<String>,
    pub stream_arn: Option<String>,
    pub read_capacity: Option<i64>,
    pub write_capacity: Option<i64>,
    pub ttl_enabled: bool,
    pub ttl_attribute: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateIndexSpec {
    pub name: String,
    pub partition_key: KeyAttr,
    pub sort_key: Option<KeyAttr>,
    pub projection: String,
    pub non_key_attributes: Option<Vec<String>>,
    pub read_capacity: Option<i64>,
    pub write_capacity: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateLsiSpec {
    pub name: String,
    pub sort_key: KeyAttr,
    pub projection: String,
    pub non_key_attributes: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTableRequest {
    pub table_name: String,
    pub partition_key: KeyAttr,
    pub sort_key: Option<KeyAttr>,
    pub billing_mode: String,
    pub read_capacity: Option<i64>,
    pub write_capacity: Option<i64>,
    pub gsis: Option<Vec<CreateIndexSpec>>,
    pub lsis: Option<Vec<CreateLsiSpec>>,
    pub stream_enabled: Option<bool>,
    pub stream_view_type: Option<String>,
    pub deletion_protection: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTableSettings {
    pub billing_mode: Option<String>,
    pub read_capacity: Option<i64>,
    pub write_capacity: Option<i64>,
    pub deletion_protection: Option<bool>,
    pub stream_enabled: Option<bool>,
    pub stream_view_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Condition {
    pub attribute: String,
    pub operator: String,
    pub value: Option<Value>,
    pub value_to: Option<Value>,
    pub values: Option<Vec<Value>>,
    pub value_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryRequest {
    pub table_name: String,
    pub index_name: Option<String>,
    pub partition_key: Condition,
    pub sort_key: Option<Condition>,
    pub filters: Option<Vec<Condition>>,
    pub limit: Option<i32>,
    pub exclusive_start_key: Option<Value>,
    pub scan_index_forward: Option<bool>,
    pub consistent_read: Option<bool>,
    pub projection: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanRequest {
    pub table_name: String,
    pub index_name: Option<String>,
    pub filters: Option<Vec<Condition>>,
    pub limit: Option<i32>,
    pub exclusive_start_key: Option<Value>,
    pub consistent_read: Option<bool>,
    pub projection: Option<String>,
    pub segment: Option<i32>,
    pub total_segments: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageResult {
    pub items: Vec<Value>,
    pub items_ddb: Vec<Value>,
    pub count: i32,
    pub scanned_count: i32,
    pub last_evaluated_key: Option<Value>,
    pub consumed_capacity: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupInfo {
    pub arn: Option<String>,
    pub name: Option<String>,
    pub status: Option<String>,
    pub created_at: Option<String>,
    pub size_bytes: Option<i64>,
    pub table_name: Option<String>,
    pub backup_type: Option<String>,
}

pub async fn list_tables(client: &Client) -> Result<Vec<String>> {
    let mut names = Vec::new();
    let mut start: Option<String> = None;
    loop {
        let mut req = client.list_tables().limit(100);
        if let Some(s) = &start {
            req = req.exclusive_start_table_name(s);
        }
        let resp = req.send().await.map_err(sdk_err)?;
        names.extend(resp.table_names().iter().cloned());
        match resp.last_evaluated_table_name() {
            Some(n) => start = Some(n.to_string()),
            None => break,
        }
    }
    names.sort();
    Ok(names)
}

pub async fn describe_table(client: &Client, table_name: &str) -> Result<TableInfo> {
    let resp = client
        .describe_table()
        .table_name(table_name)
        .send()
        .await
        .map_err(sdk_err)?;
    let table = resp
        .table()
        .ok_or_else(|| AppError::msg("DescribeTable returned no table"))?;

    let ttl = client
        .describe_time_to_live()
        .table_name(table_name)
        .send()
        .await
        .ok();
    let (ttl_enabled, ttl_attribute) = ttl
        .and_then(|t| t.time_to_live_description)
        .map(|d| {
            let enabled = d
                .time_to_live_status()
                .map(|s| s.as_str() == "ENABLED")
                .unwrap_or(false);
            (enabled, d.attribute_name().map(|s| s.to_string()))
        })
        .unwrap_or((false, None));

    let billing_mode = table
        .billing_mode_summary()
        .and_then(|b| b.billing_mode())
        .map(|m| m.as_str().to_string())
        .or_else(|| {
            table
                .provisioned_throughput()
                .map(|_| "PROVISIONED".to_string())
        });

    Ok(TableInfo {
        name: table.table_name().unwrap_or(table_name).to_string(),
        status: table.table_status().map(|s| s.as_str().to_string()),
        arn: table.table_arn().map(|s| s.to_string()),
        item_count: table.item_count(),
        table_size_bytes: table.table_size_bytes(),
        billing_mode,
        table_class: table
            .table_class_summary()
            .and_then(|c| c.table_class())
            .map(|c| c.as_str().to_string()),
        creation_date_time: table.creation_date_time().map(|d| d.to_string()),
        deletion_protection: table.deletion_protection_enabled().unwrap_or(false),
        attribute_definitions: table
            .attribute_definitions()
            .iter()
            .map(|a| KeyAttr {
                name: a.attribute_name().to_string(),
                attr_type: a.attribute_type().as_str().to_string(),
            })
            .collect(),
        key_schema: table
            .key_schema()
            .iter()
            .map(|k| IndexKey {
                name: k.attribute_name().to_string(),
                key_type: k.key_type().as_str().to_string(),
            })
            .collect(),
        gsis: table
            .global_secondary_indexes()
            .iter()
            .map(|g| IndexInfo {
                name: g.index_name().unwrap_or_default().to_string(),
                kind: "GSI".into(),
                status: g.index_status().map(|s| s.as_str().to_string()),
                key_schema: g
                    .key_schema()
                    .iter()
                    .map(|k| IndexKey {
                        name: k.attribute_name().to_string(),
                        key_type: k.key_type().as_str().to_string(),
                    })
                    .collect(),
                projection: g.projection().and_then(|p| p.projection_type()).map(|p| {
                    p.as_str().to_string()
                }),
                non_key_attributes: g
                    .projection()
                    .map(|p| p.non_key_attributes().iter().cloned().collect())
                    .unwrap_or_default(),
                item_count: g.item_count(),
                size_bytes: g.index_size_bytes(),
            })
            .collect(),
        lsis: table
            .local_secondary_indexes()
            .iter()
            .map(|l| IndexInfo {
                name: l.index_name().unwrap_or_default().to_string(),
                kind: "LSI".into(),
                status: None,
                key_schema: l
                    .key_schema()
                    .iter()
                    .map(|k| IndexKey {
                        name: k.attribute_name().to_string(),
                        key_type: k.key_type().as_str().to_string(),
                    })
                    .collect(),
                projection: l.projection().and_then(|p| p.projection_type()).map(|p| {
                    p.as_str().to_string()
                }),
                non_key_attributes: l
                    .projection()
                    .map(|p| p.non_key_attributes().iter().cloned().collect())
                    .unwrap_or_default(),
                item_count: l.item_count(),
                size_bytes: l.index_size_bytes(),
            })
            .collect(),
        stream_enabled: table
            .stream_specification()
            .map(|s| s.stream_enabled())
            .unwrap_or(false),
        stream_view_type: table
            .stream_specification()
            .and_then(|s| s.stream_view_type())
            .map(|t| t.as_str().to_string()),
        stream_arn: table.latest_stream_arn().map(|s| s.to_string()),
        read_capacity: table
            .provisioned_throughput()
            .and_then(|p| p.read_capacity_units()),
        write_capacity: table
            .provisioned_throughput()
            .and_then(|p| p.write_capacity_units()),
        ttl_enabled,
        ttl_attribute,
    })
}

pub async fn create_table(client: &Client, req: CreateTableRequest) -> Result<TableInfo> {
    if req.table_name.trim().is_empty() {
        return Err(AppError::msg("Table name is required"));
    }
    let provisioned = req.billing_mode.eq_ignore_ascii_case("PROVISIONED");
    let mut attrs: HashMap<String, ScalarAttributeType> = HashMap::new();
    insert_attr(&mut attrs, &req.partition_key)?;
    if let Some(sk) = &req.sort_key {
        insert_attr(&mut attrs, sk)?;
    }
    if let Some(gsis) = &req.gsis {
        for g in gsis {
            insert_attr(&mut attrs, &g.partition_key)?;
            if let Some(sk) = &g.sort_key {
                insert_attr(&mut attrs, sk)?;
            }
        }
    }
    if let Some(lsis) = &req.lsis {
        for l in lsis {
            insert_attr(&mut attrs, &l.sort_key)?;
        }
    }

    let attr_defs = attrs
        .into_iter()
        .map(|(name, ty)| {
            AttributeDefinition::builder()
                .attribute_name(name)
                .attribute_type(ty)
                .build()
                .map_err(|e| AppError::msg(e.to_string()))
        })
        .collect::<Result<Vec<_>>>()?;

    let mut key_schema = vec![key_element(&req.partition_key.name, KeyType::Hash)?];
    if let Some(sk) = &req.sort_key {
        key_schema.push(key_element(&sk.name, KeyType::Range)?);
    }

    let mut builder = client
        .create_table()
        .table_name(req.table_name.trim())
        .set_attribute_definitions(Some(attr_defs))
        .set_key_schema(Some(key_schema))
        .deletion_protection_enabled(req.deletion_protection.unwrap_or(false));

    if provisioned {
        builder = builder
            .billing_mode(BillingMode::Provisioned)
            .provisioned_throughput(throughput(req.read_capacity, req.write_capacity)?);
    } else {
        builder = builder.billing_mode(BillingMode::PayPerRequest);
    }

    if let Some(gsis) = req.gsis {
        let built = gsis
            .into_iter()
            .filter(|g| !g.name.trim().is_empty())
            .map(|g| build_gsi(g, provisioned))
            .collect::<Result<Vec<_>>>()?;
        if !built.is_empty() {
            builder = builder.set_global_secondary_indexes(Some(built));
        }
    }
    if let Some(lsis) = req.lsis {
        let pk_name = req.partition_key.name.clone();
        let built = lsis
            .into_iter()
            .filter(|l| !l.name.trim().is_empty())
            .map(|l| build_lsi_with_pk(&pk_name, l))
            .collect::<Result<Vec<_>>>()?;
        if !built.is_empty() {
            builder = builder.set_local_secondary_indexes(Some(built));
        }
    }
    if req.stream_enabled.unwrap_or(false) {
        let view = parse_stream_view(req.stream_view_type.as_deref().unwrap_or("NEW_AND_OLD_IMAGES"))?;
        builder = builder.stream_specification(
            StreamSpecification::builder()
                .stream_enabled(true)
                .stream_view_type(view)
                .build()
                .map_err(|e| AppError::msg(e.to_string()))?,
        );
    }

    builder.send().await.map_err(sdk_err)?;
    describe_table(client, req.table_name.trim()).await
}

pub async fn delete_table(client: &Client, table_name: &str) -> Result<()> {
    client
        .delete_table()
        .table_name(table_name)
        .send()
        .await
        .map_err(sdk_err)?;
    Ok(())
}

pub async fn update_table_settings(
    client: &Client,
    table_name: &str,
    settings: UpdateTableSettings,
) -> Result<TableInfo> {
    let mut builder = client.update_table().table_name(table_name);
    if let Some(mode) = &settings.billing_mode {
        if mode.eq_ignore_ascii_case("PROVISIONED") {
            builder = builder
                .billing_mode(BillingMode::Provisioned)
                .provisioned_throughput(throughput(settings.read_capacity, settings.write_capacity)?);
        } else {
            builder = builder.billing_mode(BillingMode::PayPerRequest);
        }
    } else if settings.read_capacity.is_some() || settings.write_capacity.is_some() {
        builder = builder.provisioned_throughput(throughput(
            settings.read_capacity,
            settings.write_capacity,
        )?);
    }
    if let Some(dp) = settings.deletion_protection {
        builder = builder.deletion_protection_enabled(dp);
    }
    if let Some(enabled) = settings.stream_enabled {
        let mut spec = StreamSpecification::builder().stream_enabled(enabled);
        if enabled {
            spec = spec.stream_view_type(parse_stream_view(
                settings
                    .stream_view_type
                    .as_deref()
                    .unwrap_or("NEW_AND_OLD_IMAGES"),
            )?);
        }
        builder = builder.stream_specification(spec.build().map_err(|e| AppError::msg(e.to_string()))?);
    }
    builder.send().await.map_err(sdk_err)?;
    describe_table(client, table_name).await
}

pub async fn update_ttl(
    client: &Client,
    table_name: &str,
    enabled: bool,
    attribute_name: String,
) -> Result<TableInfo> {
    if enabled && attribute_name.trim().is_empty() {
        return Err(AppError::msg("TTL attribute name is required"));
    }
    let spec = TimeToLiveSpecification::builder()
        .enabled(enabled)
        .attribute_name(if attribute_name.trim().is_empty() {
            "ttl"
        } else {
            attribute_name.trim()
        })
        .build()
        .map_err(|e| AppError::msg(e.to_string()))?;
    client
        .update_time_to_live()
        .table_name(table_name)
        .time_to_live_specification(spec)
        .send()
        .await
        .map_err(sdk_err)?;
    describe_table(client, table_name).await
}

pub async fn add_gsi(
    client: &Client,
    table_name: &str,
    spec: CreateIndexSpec,
    provisioned: bool,
    extra_attrs: Vec<KeyAttr>,
) -> Result<TableInfo> {
    let mut defs = Vec::new();
    for a in extra_attrs {
        defs.push(
            AttributeDefinition::builder()
                .attribute_name(a.name)
                .attribute_type(parse_scalar(&a.attr_type)?)
                .build()
                .map_err(|e| AppError::msg(e.to_string()))?,
        );
    }
    let gsi = build_gsi(spec, provisioned)?;
    let action = CreateGlobalSecondaryIndexAction::builder()
        .index_name(gsi.index_name())
        .set_key_schema(Some(gsi.key_schema().to_vec()))
        .set_projection(gsi.projection().cloned())
        .set_provisioned_throughput(gsi.provisioned_throughput().cloned())
        .build()
        .map_err(|e| AppError::msg(e.to_string()))?;
    let mut builder = client.update_table().table_name(table_name).global_secondary_index_updates(
        GlobalSecondaryIndexUpdate::builder()
            .create(action)
            .build(),
    );
    if !defs.is_empty() {
        builder = builder.set_attribute_definitions(Some(defs));
    }
    builder.send().await.map_err(sdk_err)?;
    describe_table(client, table_name).await
}

pub async fn delete_gsi(client: &Client, table_name: &str, index_name: &str) -> Result<TableInfo> {
    let action = DeleteGlobalSecondaryIndexAction::builder()
        .index_name(index_name)
        .build()
        .map_err(|e| AppError::msg(e.to_string()))?;
    client
        .update_table()
        .table_name(table_name)
        .global_secondary_index_updates(
            GlobalSecondaryIndexUpdate::builder().delete(action).build(),
        )
        .send()
        .await
        .map_err(sdk_err)?;
    describe_table(client, table_name).await
}

pub async fn scan_items(client: &Client, req: ScanRequest) -> Result<PageResult> {
    let (filter, names, values) = build_filter(req.filters.as_deref().unwrap_or(&[]))?;
    let mut builder = client
        .scan()
        .table_name(req.table_name)
        .return_consumed_capacity(ReturnConsumedCapacity::Total);
    if let Some(index) = req.index_name.filter(|s| !s.is_empty()) {
        builder = builder.index_name(index);
    }
    if let Some(expr) = filter {
        builder = builder.filter_expression(expr);
    }
    if !names.is_empty() {
        builder = builder.set_expression_attribute_names(Some(names));
    }
    if !values.is_empty() {
        builder = builder.set_expression_attribute_values(Some(values));
    }
    if let Some(limit) = req.limit {
        builder = builder.limit(limit);
    }
    if let Some(key) = req.exclusive_start_key {
        builder = builder.set_exclusive_start_key(Some(json_map_to_item_ddb(&key)?));
    }
    if let Some(cr) = req.consistent_read {
        builder = builder.consistent_read(cr);
    }
    if let Some(proj) = req.projection.filter(|s| !s.is_empty()) {
        builder = builder.projection_expression(proj);
    }
    if let (Some(seg), Some(total)) = (req.segment, req.total_segments) {
        builder = builder.segment(seg).total_segments(total);
    }
    let resp = builder.send().await.map_err(sdk_err)?;
    Ok(page_from(
        resp.items,
        resp.count,
        resp.scanned_count,
        resp.last_evaluated_key,
        resp.consumed_capacity.and_then(|c| c.capacity_units()),
    ))
}

pub async fn query_items(client: &Client, req: QueryRequest) -> Result<PageResult> {
    let mut names = HashMap::new();
    let mut values = HashMap::new();
    let mut parts = Vec::new();

    let pk_name = req.partition_key.attribute.trim();
    if pk_name.is_empty() {
        return Err(AppError::msg("Partition key is required"));
    }
    let pk_val = req
        .partition_key
        .value
        .as_ref()
        .ok_or_else(|| AppError::msg("Partition key value is required"))?;
    names.insert("#pk".into(), pk_name.to_string());
    values.insert(
        ":pk".into(),
        typed_value(pk_val, req.partition_key.value_type.as_deref())?,
    );
    parts.push("#pk = :pk".to_string());

    if let Some(sk) = &req.sort_key {
        if !sk.attribute.trim().is_empty() && has_value(sk) {
            parts.push(push_condition(sk, "sk", &mut names, &mut values, false)?);
        }
    }

    let key_expr = parts.join(" AND ");
    let (filter, fnames, fvalues) = build_filter(req.filters.as_deref().unwrap_or(&[]))?;
    names.extend(fnames);
    values.extend(fvalues);

    let mut builder = client
        .query()
        .table_name(req.table_name)
        .key_condition_expression(key_expr)
        .return_consumed_capacity(ReturnConsumedCapacity::Total)
        .select(Select::AllAttributes);
    if let Some(index) = req.index_name.filter(|s| !s.is_empty()) {
        builder = builder.index_name(index);
    }
    if let Some(expr) = filter {
        builder = builder.filter_expression(expr);
    }
    if !names.is_empty() {
        builder = builder.set_expression_attribute_names(Some(names));
    }
    if !values.is_empty() {
        builder = builder.set_expression_attribute_values(Some(values));
    }
    if let Some(limit) = req.limit {
        builder = builder.limit(limit);
    }
    if let Some(key) = req.exclusive_start_key {
        builder = builder.set_exclusive_start_key(Some(json_map_to_item_ddb(&key)?));
    }
    if let Some(fwd) = req.scan_index_forward {
        builder = builder.scan_index_forward(fwd);
    }
    if let Some(cr) = req.consistent_read {
        builder = builder.consistent_read(cr);
    }
    if let Some(proj) = req.projection.filter(|s| !s.is_empty()) {
        builder = builder.projection_expression(proj).select(Select::SpecificAttributes);
    }
    let resp = builder.send().await.map_err(sdk_err)?;
    Ok(page_from(
        resp.items,
        resp.count,
        resp.scanned_count,
        resp.last_evaluated_key,
        resp.consumed_capacity.and_then(|c| c.capacity_units()),
    ))
}

pub async fn get_item(
    client: &Client,
    table_name: &str,
    key: Value,
    consistent: bool,
) -> Result<Option<Value>> {
    let resp = client
        .get_item()
        .table_name(table_name)
        .set_key(Some(json_map_to_item_ddb(&key)?))
        .consistent_read(consistent)
        .send()
        .await
        .map_err(sdk_err)?;
    Ok(resp.item.map(|item| item_to_document(&item)))
}

pub async fn put_item(client: &Client, table_name: &str, item: Value, format: &str) -> Result<()> {
    client
        .put_item()
        .table_name(table_name)
        .set_item(Some(json_to_item(&item, format)?))
        .send()
        .await
        .map_err(sdk_err)?;
    Ok(())
}

pub async fn delete_item(client: &Client, table_name: &str, key: Value) -> Result<()> {
    client
        .delete_item()
        .table_name(table_name)
        .set_key(Some(json_map_to_item_ddb(&key)?))
        .send()
        .await
        .map_err(sdk_err)?;
    Ok(())
}

pub async fn batch_put_items(client: &Client, table_name: &str, items: Vec<Value>, format: &str) -> Result<usize> {
    use aws_sdk_dynamodb::types::{PutRequest, WriteRequest};
    let mut written = 0usize;
    for chunk in items.chunks(25) {
        let writes = chunk
            .iter()
            .map(|item| {
                let put = PutRequest::builder()
                    .set_item(Some(json_to_item(item, format)?))
                    .build()
                    .map_err(|e| AppError::msg(e.to_string()))?;
                Ok(WriteRequest::builder().put_request(put).build())
            })
            .collect::<Result<Vec<_>>>()?;
        client
            .batch_write_item()
            .request_items(table_name, writes)
            .send()
            .await
            .map_err(sdk_err)?;
        written += chunk.len();
    }
    Ok(written)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchMutateResult {
    pub succeeded: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoftDeleteSpec {
    pub rename_partition: bool,
    pub rename_sort: bool,
    pub strategy: String,
    pub token: String,
    pub stamp_deleted_at: bool,
    pub deleted_at: Option<String>,
}

pub async fn batch_delete_items(
    client: &Client,
    table_name: &str,
    keys: Vec<Value>,
) -> Result<BatchMutateResult> {
    use aws_sdk_dynamodb::types::{DeleteRequest, WriteRequest};
    let mut succeeded = 0usize;
    let mut errors = Vec::new();
    for chunk in keys.chunks(25) {
        let writes = match chunk
            .iter()
            .map(|key| {
                let del = DeleteRequest::builder()
                    .set_key(Some(json_map_to_item_ddb(key)?))
                    .build()
                    .map_err(|e| AppError::msg(e.to_string()))?;
                Ok(WriteRequest::builder().delete_request(del).build())
            })
            .collect::<Result<Vec<_>>>()
        {
            Ok(w) => w,
            Err(e) => {
                errors.push(e.to_string());
                continue;
            }
        };
        match client
            .batch_write_item()
            .request_items(table_name, writes)
            .send()
            .await
        {
            Ok(resp) => {
                let unprocessed = resp
                    .unprocessed_items()
                    .and_then(|m| m.get(table_name))
                    .map(|v| v.len())
                    .unwrap_or(0);
                succeeded += chunk.len().saturating_sub(unprocessed);
                if unprocessed > 0 {
                    errors.push(format!(
                        "{unprocessed} delete(s) were unprocessed; try again"
                    ));
                }
            }
            Err(e) => errors.push(e.to_string()),
        }
    }
    Ok(BatchMutateResult {
        succeeded,
        skipped: 0,
        errors,
    })
}

pub async fn soft_delete_items(
    client: &Client,
    table_name: &str,
    items: Vec<Value>,
    spec: SoftDeleteSpec,
) -> Result<BatchMutateResult> {
    let described = describe_table(client, table_name).await?;
    let pk = described
        .key_schema
        .iter()
        .find(|k| k.key_type == "HASH")
        .map(|k| k.name.clone())
        .ok_or_else(|| AppError::msg("Table has no partition key"))?;
    let sk = described
        .key_schema
        .iter()
        .find(|k| k.key_type == "RANGE")
        .map(|k| k.name.clone());
    let pk_type = described
        .attribute_definitions
        .iter()
        .find(|a| a.name == pk)
        .map(|a| a.attr_type.as_str())
        .unwrap_or("S");
    let sk_type = sk.as_ref().and_then(|name| {
        described
            .attribute_definitions
            .iter()
            .find(|a| &a.name == name)
            .map(|a| a.attr_type.as_str())
    });

    if spec.rename_partition && pk_type != "S" {
        return Err(AppError::msg(format!(
            "Partition key `{pk}` is type {pk_type}. Prefix/suffix soft-delete only works on string (S) keys."
        )));
    }
    if spec.rename_sort {
        match (sk.as_deref(), sk_type) {
            (None, _) => {
                return Err(AppError::msg(
                    "This table has no sort key. Uncheck sort-key rename or rename the partition key.",
                ));
            }
            (Some(name), Some(ty)) if ty != "S" => {
                return Err(AppError::msg(format!(
                    "Sort key `{name}` is type {ty}. Prefix/suffix soft-delete only works on string (S) keys."
                )));
            }
            _ => {}
        }
    }
    if !spec.rename_partition && !spec.rename_sort {
        return Err(AppError::msg(
            "Choose at least one key to rename (partition and/or sort).",
        ));
    }
    let token = spec.token.trim();
    if token.is_empty() {
        return Err(AppError::msg("Soft-delete token cannot be empty"));
    }

    let mut succeeded = 0usize;
    let mut skipped = 0usize;
    let mut errors = Vec::new();

    for (i, item) in items.iter().enumerate() {
        let obj = match item.as_object() {
            Some(o) => o.clone(),
            None => {
                errors.push(format!("Item {}: not a JSON object", i + 1));
                continue;
            }
        };
        let Some(old_pk) = obj.get(&pk) else {
            errors.push(format!("Item {}: missing partition key `{pk}`", i + 1));
            continue;
        };
        let mut new_obj = obj.clone();
        let mut changed = false;

        if spec.rename_partition {
            match apply_key_token(old_pk, &spec.strategy, token) {
                Ok((next, already)) => {
                    if already {
                        skipped += 1;
                        continue;
                    }
                    new_obj.insert(pk.clone(), next);
                    changed = true;
                }
                Err(e) => {
                    errors.push(format!("Item {}: {e}", i + 1));
                    continue;
                }
            }
        }
        if spec.rename_sort {
            if let Some(sk_name) = &sk {
                let Some(old_sk) = obj.get(sk_name) else {
                    errors.push(format!("Item {}: missing sort key `{sk_name}`", i + 1));
                    continue;
                };
                match apply_key_token(old_sk, &spec.strategy, token) {
                    Ok((next, already)) => {
                        if already && !spec.rename_partition {
                            skipped += 1;
                            continue;
                        }
                        if !already {
                            new_obj.insert(sk_name.clone(), next);
                            changed = true;
                        }
                    }
                    Err(e) => {
                        errors.push(format!("Item {}: {e}", i + 1));
                        continue;
                    }
                }
            }
        }

        if !changed {
            skipped += 1;
            continue;
        }

        if spec.stamp_deleted_at {
            if let Some(ts) = &spec.deleted_at {
                new_obj.insert("_deletedAt".into(), Value::String(ts.clone()));
            }
            new_obj.insert("_originalKeys".into(), extract_key_object(&obj, &pk, sk.as_deref()));
        }

        let new_item = Value::Object(new_obj);
        let old_key = extract_key_object(&obj, &pk, sk.as_deref());

        let mut cond_names = HashMap::new();
        cond_names.insert("#pk".into(), pk.clone());
        let cond = if let Some(sk_name) = &sk {
            cond_names.insert("#sk".into(), sk_name.clone());
            "attribute_not_exists(#pk) AND attribute_not_exists(#sk)"
        } else {
            "attribute_not_exists(#pk)"
        };

        let put_item = match json_to_item(&new_item, "document") {
            Ok(item) => item,
            Err(e) => {
                errors.push(format!("Item {}: {e}", i + 1));
                continue;
            }
        };
        match client
            .put_item()
            .table_name(table_name)
            .set_item(Some(put_item))
            .condition_expression(cond)
            .set_expression_attribute_names(Some(cond_names))
            .send()
            .await
        {
            Ok(_) => {}
            Err(e) => {
                errors.push(format!("Item {}: write new key failed: {e}", i + 1));
                continue;
            }
        }

        let delete_key = match json_map_to_item_ddb(&old_key) {
            Ok(k) => k,
            Err(e) => {
                errors.push(format!(
                    "Item {}: new item written but original key is invalid: {e}",
                    i + 1
                ));
                continue;
            }
        };
        match client
            .delete_item()
            .table_name(table_name)
            .set_key(Some(delete_key))
            .send()
            .await
        {
            Ok(_) => succeeded += 1,
            Err(e) => errors.push(format!(
                "Item {}: new item written but original was not deleted: {e}",
                i + 1
            )),
        }
    }

    Ok(BatchMutateResult {
        succeeded,
        skipped,
        errors,
    })
}

fn extract_key_object(
    item: &serde_json::Map<String, Value>,
    pk: &str,
    sk: Option<&str>,
) -> Value {
    let mut key = serde_json::Map::new();
    if let Some(v) = item.get(pk) {
        key.insert(pk.to_string(), v.clone());
    }
    if let Some(name) = sk {
        if let Some(v) = item.get(name) {
            key.insert(name.to_string(), v.clone());
        }
    }
    Value::Object(key)
}

fn apply_key_token(value: &Value, strategy: &str, token: &str) -> Result<(Value, bool)> {
    let s = match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => {
            return Err(AppError::msg(format!(
                "key is numeric ({n}); prefix/suffix requires a string key"
            )));
        }
        Value::Null => return Err(AppError::msg("key is null")),
        other => other.to_string(),
    };
    let already = s.starts_with(token) || s.ends_with(token);
    if already {
        return Ok((Value::String(s), true));
    }
    let next = if strategy.eq_ignore_ascii_case("suffix") {
        format!("{s}{token}")
    } else {
        format!("{token}{s}")
    };
    Ok((Value::String(next), false))
}

pub async fn execute_partiql(
    client: &Client,
    statement: &str,
    next_token: Option<String>,
    limit: Option<i32>,
) -> Result<PageResult> {
    if statement.trim().is_empty() {
        return Err(AppError::msg("PartiQL statement is required"));
    }
    let mut builder = client
        .execute_statement()
        .statement(statement.trim())
        .return_consumed_capacity(ReturnConsumedCapacity::Total);
    if let Some(token) = next_token.filter(|s| !s.is_empty()) {
        builder = builder.next_token(token);
    }
    if let Some(limit) = limit {
        builder = builder.limit(limit);
    }
    let resp = builder.send().await.map_err(sdk_err)?;
    let items: Vec<_> = resp.items.unwrap_or_default();
    let last = resp.next_token.map(|t| serde_json::json!({ "nextToken": t }));
    Ok(PageResult {
        items: items.iter().map(item_to_document).collect(),
        items_ddb: items.iter().map(item_to_ddb_json).collect(),
        count: items.len() as i32,
        scanned_count: items.len() as i32,
        last_evaluated_key: last,
        consumed_capacity: resp.consumed_capacity.and_then(|c| c.capacity_units()),
    })
}

pub async fn list_backups(client: &Client, table_name: &str) -> Result<Vec<BackupInfo>> {
    let resp = client
        .list_backups()
        .table_name(table_name)
        .backup_type(BackupTypeFilter::All)
        .send()
        .await
        .map_err(sdk_err)?;
    Ok(resp
        .backup_summaries()
        .iter()
        .map(|b| BackupInfo {
            arn: b.backup_arn().map(|s| s.to_string()),
            name: b.backup_name().map(|s| s.to_string()),
            status: b.backup_status().map(|s| s.as_str().to_string()),
            created_at: b.backup_creation_date_time().map(|d| d.to_string()),
            size_bytes: b.backup_size_bytes(),
            table_name: b.table_name().map(|s| s.to_string()),
            backup_type: b.backup_type().map(|s| s.as_str().to_string()),
        })
        .collect())
}

pub async fn create_backup(client: &Client, table_name: &str, backup_name: &str) -> Result<BackupInfo> {
    let resp = client
        .create_backup()
        .table_name(table_name)
        .backup_name(backup_name)
        .send()
        .await
        .map_err(sdk_err)?;
    let d = resp.backup_details();
    Ok(BackupInfo {
        arn: d.map(|b| b.backup_arn().to_string()),
        name: d.map(|b| b.backup_name().to_string()),
        status: d.map(|b| b.backup_status().as_str().to_string()),
        created_at: d.map(|b| b.backup_creation_date_time().to_string()),
        size_bytes: d.and_then(|b| b.backup_size_bytes()),
        table_name: Some(table_name.to_string()),
        backup_type: d.map(|b| b.backup_type().as_str().to_string()),
    })
}

pub async fn delete_backup(client: &Client, backup_arn: &str) -> Result<()> {
    client
        .delete_backup()
        .backup_arn(backup_arn)
        .send()
        .await
        .map_err(sdk_err)?;
    Ok(())
}

pub async fn restore_backup(
    client: &Client,
    backup_arn: &str,
    target_table_name: &str,
) -> Result<TableInfo> {
    client
        .restore_table_from_backup()
        .backup_arn(backup_arn)
        .target_table_name(target_table_name)
        .send()
        .await
        .map_err(sdk_err)?;
    describe_table(client, target_table_name).await
}

fn page_from(
    items: Option<Vec<HashMap<String, aws_sdk_dynamodb::types::AttributeValue>>>,
    count: i32,
    scanned: i32,
    last: Option<HashMap<String, aws_sdk_dynamodb::types::AttributeValue>>,
    consumed: Option<f64>,
) -> PageResult {
    let items = items.unwrap_or_default();
    PageResult {
        items: items.iter().map(item_to_document).collect(),
        items_ddb: items.iter().map(item_to_ddb_json).collect(),
        count,
        scanned_count: scanned,
        last_evaluated_key: last.map(|k| item_to_ddb_json(&k)),
        consumed_capacity: consumed,
    }
}

fn insert_attr(map: &mut HashMap<String, ScalarAttributeType>, attr: &KeyAttr) -> Result<()> {
    if attr.name.trim().is_empty() {
        return Err(AppError::msg("Attribute name is required"));
    }
    map.insert(attr.name.trim().to_string(), parse_scalar(&attr.attr_type)?);
    Ok(())
}

fn parse_scalar(ty: &str) -> Result<ScalarAttributeType> {
    match ty.to_ascii_uppercase().as_str() {
        "S" => Ok(ScalarAttributeType::S),
        "N" => Ok(ScalarAttributeType::N),
        "B" => Ok(ScalarAttributeType::B),
        other => Err(AppError::msg(format!("Unsupported attribute type {other}"))),
    }
}

fn key_element(name: &str, key_type: KeyType) -> Result<KeySchemaElement> {
    KeySchemaElement::builder()
        .attribute_name(name)
        .key_type(key_type)
        .build()
        .map_err(|e| AppError::msg(e.to_string()))
}

fn throughput(read: Option<i64>, write: Option<i64>) -> Result<ProvisionedThroughput> {
    ProvisionedThroughput::builder()
        .read_capacity_units(read.unwrap_or(5))
        .write_capacity_units(write.unwrap_or(5))
        .build()
        .map_err(|e| AppError::msg(e.to_string()))
}

fn parse_projection(spec: &str, non_key: Option<&[String]>) -> Result<Projection> {
    let mut b = Projection::builder();
    match spec.to_ascii_uppercase().as_str() {
        "KEYS_ONLY" => b = b.projection_type(ProjectionType::KeysOnly),
        "INCLUDE" => {
            b = b.projection_type(ProjectionType::Include);
            if let Some(attrs) = non_key {
                for a in attrs {
                    if !a.trim().is_empty() {
                        b = b.non_key_attributes(a.trim());
                    }
                }
            }
        }
        _ => b = b.projection_type(ProjectionType::All),
    }
    Ok(b.build())
}

fn parse_stream_view(v: &str) -> Result<StreamViewType> {
    match v.to_ascii_uppercase().as_str() {
        "KEYS_ONLY" => Ok(StreamViewType::KeysOnly),
        "NEW_IMAGE" => Ok(StreamViewType::NewImage),
        "OLD_IMAGE" => Ok(StreamViewType::OldImage),
        _ => Ok(StreamViewType::NewAndOldImages),
    }
}

fn build_gsi(spec: CreateIndexSpec, provisioned: bool) -> Result<GlobalSecondaryIndex> {
    let mut schema = vec![key_element(&spec.partition_key.name, KeyType::Hash)?];
    if let Some(sk) = &spec.sort_key {
        if !sk.name.trim().is_empty() {
            schema.push(key_element(&sk.name, KeyType::Range)?);
        }
    }
    let mut b = GlobalSecondaryIndex::builder()
        .index_name(spec.name.trim())
        .set_key_schema(Some(schema))
        .projection(parse_projection(
            &spec.projection,
            spec.non_key_attributes.as_deref(),
        )?);
    if provisioned {
        b = b.provisioned_throughput(throughput(spec.read_capacity, spec.write_capacity)?);
    }
    b.build().map_err(|e| AppError::msg(e.to_string()))
}

fn build_filter(
    filters: &[Condition],
) -> Result<(
    Option<String>,
    HashMap<String, String>,
    HashMap<String, aws_sdk_dynamodb::types::AttributeValue>,
)> {
    let mut names = HashMap::new();
    let mut values = HashMap::new();
    let mut parts = Vec::new();
    for (i, f) in filters.iter().enumerate() {
        if f.attribute.trim().is_empty() {
            continue;
        }
        if !has_value(f)
            && !matches!(
                f.operator.to_ascii_lowercase().as_str(),
                "exists" | "not_exists"
            )
        {
            continue;
        }
        parts.push(push_condition(
            f,
            &format!("f{i}"),
            &mut names,
            &mut values,
            true,
        )?);
    }
    if parts.is_empty() {
        Ok((None, names, values))
    } else {
        Ok((Some(parts.join(" AND ")), names, values))
    }
}

fn has_value(c: &Condition) -> bool {
    match c.operator.to_ascii_lowercase().as_str() {
        "exists" | "not_exists" => true,
        "between" => c.value.is_some() && c.value_to.is_some(),
        "in" => c
            .values
            .as_ref()
            .map(|v| !v.is_empty())
            .unwrap_or(false)
            || c.value.is_some(),
        _ => c.value.as_ref().is_some_and(|v| !is_empty_value(v)),
    }
}

fn is_empty_value(v: &Value) -> bool {
    match v {
        Value::String(s) => s.is_empty(),
        Value::Null => true,
        _ => false,
    }
}

fn push_condition(
    c: &Condition,
    id: &str,
    names: &mut HashMap<String, String>,
    values: &mut HashMap<String, aws_sdk_dynamodb::types::AttributeValue>,
    allow_filter_ops: bool,
) -> Result<String> {
    let name_tok = format!("#{id}");
    let val_tok = format!(":{id}");
    names.insert(name_tok.clone(), c.attribute.trim().to_string());
    let op = c.operator.to_ascii_lowercase();
    let ty = c.value_type.as_deref();

    let expr = match op.as_str() {
        "eq" | "=" => {
            values.insert(val_tok.clone(), typed_value(c.value.as_ref().unwrap(), ty)?);
            format!("{name_tok} = {val_tok}")
        }
        "ne" | "<>" | "!=" if allow_filter_ops => {
            values.insert(val_tok.clone(), typed_value(c.value.as_ref().unwrap(), ty)?);
            format!("{name_tok} <> {val_tok}")
        }
        "lt" | "<" => {
            values.insert(val_tok.clone(), typed_value(c.value.as_ref().unwrap(), ty)?);
            format!("{name_tok} < {val_tok}")
        }
        "lte" | "<=" => {
            values.insert(val_tok.clone(), typed_value(c.value.as_ref().unwrap(), ty)?);
            format!("{name_tok} <= {val_tok}")
        }
        "gt" | ">" => {
            values.insert(val_tok.clone(), typed_value(c.value.as_ref().unwrap(), ty)?);
            format!("{name_tok} > {val_tok}")
        }
        "gte" | ">=" => {
            values.insert(val_tok.clone(), typed_value(c.value.as_ref().unwrap(), ty)?);
            format!("{name_tok} >= {val_tok}")
        }
        "begins_with" => {
            values.insert(val_tok.clone(), typed_value(c.value.as_ref().unwrap(), ty)?);
            format!("begins_with({name_tok}, {val_tok})")
        }
        "contains" if allow_filter_ops => {
            values.insert(val_tok.clone(), typed_value(c.value.as_ref().unwrap(), ty)?);
            format!("contains({name_tok}, {val_tok})")
        }
        "exists" if allow_filter_ops => format!("attribute_exists({name_tok})"),
        "not_exists" if allow_filter_ops => format!("attribute_not_exists({name_tok})"),
        "between" => {
            let to_tok = format!(":{id}b");
            values.insert(val_tok.clone(), typed_value(c.value.as_ref().unwrap(), ty)?);
            values.insert(to_tok.clone(), typed_value(c.value_to.as_ref().unwrap(), ty)?);
            format!("{name_tok} BETWEEN {val_tok} AND {to_tok}")
        }
        "in" if allow_filter_ops => {
            let list = if let Some(vs) = &c.values {
                vs.clone()
            } else if let Some(Value::String(s)) = &c.value {
                s.split(',')
                    .map(|p| Value::String(p.trim().to_string()))
                    .filter(|v| !is_empty_value(v))
                    .collect()
            } else if let Some(v) = &c.value {
                vec![v.clone()]
            } else {
                vec![]
            };
            if list.is_empty() {
                return Err(AppError::msg("IN requires at least one value"));
            }
            let mut toks = Vec::new();
            for (i, v) in list.iter().enumerate() {
                let tok = format!(":{id}i{i}");
                values.insert(tok.clone(), typed_value(v, ty)?);
                toks.push(tok);
            }
            format!("{name_tok} IN ({})", toks.join(", "))
        }
        other => {
            return Err(AppError::msg(format!("Unsupported operator '{other}'")));
        }
    };
    Ok(expr)
}

fn build_lsi_with_pk(table_pk: &str, spec: CreateLsiSpec) -> Result<LocalSecondaryIndex> {
    let schema = vec![
        key_element(table_pk, KeyType::Hash)?,
        key_element(&spec.sort_key.name, KeyType::Range)?,
    ];
    LocalSecondaryIndex::builder()
        .index_name(spec.name.trim())
        .set_key_schema(Some(schema))
        .projection(parse_projection(
            &spec.projection,
            spec.non_key_attributes.as_deref(),
        )?)
        .build()
        .map_err(|e| AppError::msg(e.to_string()))
}
