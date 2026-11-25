using System.Globalization;
using System.Xml.Linq;

namespace BpmnStudio;

public record DiffDetail(string Field, string? From, string? To);
public record DiffItem(string Id, string Type, string? Name, string Kind, List<DiffDetail> Details);

/// <summary>Element-level diff of two BPMN files, matched by element id.</summary>
public static class BpmnDiff
{
    static readonly XNamespace M = "http://www.omg.org/spec/BPMN/20100524/MODEL";
    static readonly XNamespace Di = "http://www.omg.org/spec/BPMN/20100524/DI";
    static readonly XNamespace Dc = "http://www.omg.org/spec/DD/20100524/DC";
    static readonly HashSet<string> IgnoredAttrs =
        ["id", "name", "exporter", "exporterVersion", "expressionLanguage", "typeLanguage", "targetNamespace"];

    sealed record Node(string Type, string? Name, SortedDictionary<string, string?> Props, string? Bounds);

    static string Num(XElement b, string attr)
    {
        var ok = double.TryParse((string?)b.Attribute(attr), NumberStyles.Float, CultureInfo.InvariantCulture, out var v);
        return Math.Round(ok ? v : 0).ToString(CultureInfo.InvariantCulture);
    }

    static Dictionary<string, Node> Parse(string xml)
    {
        var doc = XmlGuard.Load(xml);
        var nodes = new Dictionary<string, Node>();
        foreach (var e in doc.Descendants())
        {
            if (e.Name.Namespace != M || e.Name.LocalName == "definitions") continue;
            var id = (string?)e.Attribute("id");
            if (id is null) continue;
            var props = new SortedDictionary<string, string?>(StringComparer.Ordinal);
            foreach (var a in e.Attributes())
            {
                if (a.IsNamespaceDeclaration || a.Name.Namespace != XNamespace.None) continue;
                if (IgnoredAttrs.Contains(a.Name.LocalName)) continue;
                props[a.Name.LocalName] = a.Value;
            }
            if (e.Element(M + "conditionExpression") is { } cond) props["conditionExpression"] = cond.Value.Trim();
            if (e.Element(M + "documentation") is { } docu) props["documentation"] = docu.Value.Trim();
            var defs = e.Elements().Where(x => x.Name.Namespace == M && x.Name.LocalName.EndsWith("EventDefinition"))
                .Select(x => x.Name.LocalName).OrderBy(x => x).ToList();
            if (defs.Count > 0) props["eventDefinition"] = string.Join(",", defs);
            nodes[id] = new Node(e.Name.LocalName, (string?)e.Attribute("name"), props, null);
        }
        foreach (var s in doc.Descendants(Di + "BPMNShape"))
        {
            var el = (string?)s.Attribute("bpmnElement");
            var b = s.Element(Dc + "Bounds");
            if (el != null && b != null && nodes.TryGetValue(el, out var n))
                nodes[el] = n with { Bounds = $"{Num(b, "x")},{Num(b, "y")},{Num(b, "width")},{Num(b, "height")}" };
        }
        return nodes;
    }

    public static List<DiffItem> Compare(string oldXml, string newXml)
    {
        var a = Parse(oldXml);
        var b = Parse(newXml);
        var items = new List<DiffItem>();
        foreach (var (id, n) in b)
        {
            if (!a.TryGetValue(id, out var o)) { items.Add(new(id, n.Type, n.Name, "added", [])); continue; }
            var details = new List<DiffDetail>();
            if (o.Type != n.Type) details.Add(new("type", o.Type, n.Type));
            if ((o.Name ?? "").Trim() != (n.Name ?? "").Trim()) details.Add(new("name", o.Name, n.Name));
            foreach (var k in o.Props.Keys.Union(n.Props.Keys).OrderBy(x => x, StringComparer.Ordinal))
            {
                o.Props.TryGetValue(k, out var ov);
                n.Props.TryGetValue(k, out var nv);
                if (ov != nv) details.Add(new(k, ov, nv));
            }
            if (details.Count > 0) items.Add(new(id, n.Type, n.Name ?? o.Name, "changed", details));
            else if (o.Bounds != n.Bounds) items.Add(new(id, n.Type, n.Name, "moved", []));
        }
        foreach (var (id, o) in a)
            if (!b.ContainsKey(id)) items.Add(new(id, o.Type, o.Name, "removed", []));
        return items;
    }
}
