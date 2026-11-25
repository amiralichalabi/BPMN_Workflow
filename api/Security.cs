using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Xml;
using System.Xml.Linq;

namespace BpmnStudio;

public static class Pw
{
    const int Iterations = 600_000;
    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var h = Rfc2898DeriveBytes.Pbkdf2(password, salt, Iterations, HashAlgorithmName.SHA256, 32);
        return $"v1.{Iterations}.{Convert.ToBase64String(salt)}.{Convert.ToBase64String(h)}";
    }
    public static bool Verify(string password, string stored)
    {
        var p = stored.Split('.');
        if (p.Length != 4 || p[0] != "v1" || !int.TryParse(p[1], out var iter)) return false;
        var salt = Convert.FromBase64String(p[2]);
        var expected = Convert.FromBase64String(p[3]);
        var h = Rfc2898DeriveBytes.Pbkdf2(password, salt, iter, HashAlgorithmName.SHA256, expected.Length);
        return CryptographicOperations.FixedTimeEquals(h, expected);
    }
    // used to keep login timing equal for unknown users
    public static readonly string Dummy = Hash("timing-equalizer-not-a-real-password");
}

public static class Api
{
    public static IResult Err(int code, string msg) => Results.Json(new { error = msg }, statusCode: code);
    public static string UserName(HttpContext c) => c.User.Identity?.Name ?? "anonymous";
}

public static class Audit
{
    public static async Task Log(AppDb db, HttpContext ctx, string action, Guid? diagramId = null,
        object? detail = null, string? user = null)
    {
        db.AuditEvents.Add(new AuditEvent
        {
            UserName = user ?? Api.UserName(ctx),
            Action = action,
            DiagramId = diagramId,
            Detail = detail is null ? null : JsonSerializer.Serialize(detail),
            CorrelationId = ctx.TraceIdentifier,
            IpAddress = ctx.Connection.RemoteIpAddress?.ToString()
        });
        await db.SaveChangesAsync();
    }
}

public static class XmlGuard
{
    static readonly XNamespace M = "http://www.omg.org/spec/BPMN/20100524/MODEL";

    /// <summary>Parses XML with DTD processing prohibited (XXE protection).</summary>
    public static XDocument Load(string xml)
    {
        var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null };
        using var r = XmlReader.Create(new StringReader(xml), settings);
        return XDocument.Load(r);
    }

    public static string? Validate(string? xml)
    {
        if (string.IsNullOrWhiteSpace(xml)) return "محتوای BPMN خالی است";
        if (xml.Length > 5_000_000) return "حجم فایل بیش از حد مجاز است (حداکثر ۵ مگابایت)";
        try
        {
            var doc = Load(xml);
            if (doc.Root?.Name != M + "definitions") return "این فایل یک BPMN 2.0 معتبر نیست (ریشه definitions یافت نشد)";
            if (!doc.Descendants().Any(e => e.Name == M + "process" || e.Name == M + "collaboration"))
                return "نمودار باید حداقل یک process یا collaboration داشته باشد";
            return null;
        }
        catch (XmlException) { return "فایل XML نامعتبر است"; }
    }

    public static string Hash(string xml) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(xml))).ToLowerInvariant();

    public static string Blank() => """
        <?xml version="1.0" encoding="UTF-8"?>
        <bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
          <bpmn:process id="Process_1" isExecutable="false">
            <bpmn:startEvent id="StartEvent_1" name="شروع" />
          </bpmn:process>
          <bpmndi:BPMNDiagram id="BPMNDiagram_1">
            <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
              <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
                <dc:Bounds x="182" y="102" width="36" height="36" />
              </bpmndi:BPMNShape>
            </bpmndi:BPMNPlane>
          </bpmndi:BPMNDiagram>
        </bpmn:definitions>
        """;
}
