// 持久化前集合项脱敏的纯逻辑层（从 components/AICrewStudio.jsx 抽出，守纯逻辑/副作用分离）。
//
// 不变量：剥离集合项内变体的媒体（封面 base64 等大体积字段下沉独立存储），但**项级标量字段
// 必须原样保留**——尤其 task.scheduledAt（排期层）绝不能被吞掉，否则刷新即丢排期。
// 具体「如何剥一个变体的媒体」(stripVariant) 由调用方注入：媒体剥离细节仍属组件层副作用治理，
// 本模块只负责「遍历集合、保留项标量、只对 variants 施加注入的剥离器」这一纯遍历契约。

// 遍历集合，对每项：若含 variants 则用注入的 stripVariant 逐个剥离其媒体并展开保留其余字段；
// 否则原样返回。`{ ...item, variants }` 的展开确保 item 的所有标量（含 scheduledAt）存活。
export function stripCollectionMedia(list, stripVariant) {
  return (list || []).map(item =>
    item?.variants ? { ...item, variants: item.variants.map(stripVariant) } : item
  );
}
