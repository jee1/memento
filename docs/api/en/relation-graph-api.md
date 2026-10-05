# RelationGraph API specification

Memories rarely stand alone: a fix today may **depend on** yesterday’s decision, or **support** an episodic note. `RelationGraph` stores those **semantic edges**—causal, dependency, temporal, and contextual links—and feeds them into graph traversal and the anchor map UI (they no longer affect search ranking since v2.0.0, #1245). Agents manipulate relations through MCP tools `add_relation`, `get_relations`, and `remove_relation`; operators use HTTP admin routes under `/admin/relations/*`.

The Korean spec below is the **source of truth** for TypeScript interfaces, SQL shapes, duplicate/cycle handling, and worked examples. Read this page for orientation, then follow the KO link when implementing or reviewing API changes.

Full spec (KO): [relation-graph-api.md (KO)](../ko/relation-graph-api.md).
