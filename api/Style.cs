using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;

namespace BpmnStudio;

public record ColorPair(string Fill, string Stroke);
public record DiagramStyle(string Font, int FontSize, Dictionary<string, ColorPair> Colors);

/// <summary>Workspace-wide look of diagrams (colours per element type + font). Stored once, shown to everyone.</summary>
public static class StyleStore
{
    public const string Key = "diagramStyle";
    public static readonly string[] Fonts = ["auto", "vazirmatn", "times", "tahoma", "arial", "georgia", "courier"];

    public static DiagramStyle Default() => new("auto", 13, new Dictionary<string, ColorPair>
    {
        ["task"] = new("#dbeafe", "#1d4ed8"),
        ["subProcess"] = new("#e0e7ff", "#4338ca"),
        ["startEvent"] = new("#dcfce7", "#15803d"),
        ["intermediateEvent"] = new("#fef9c3", "#ca8a04"),
        ["endEvent"] = new("#fee2e2", "#b91c1c"),
        ["gateway"] = new("#fde68a", "#a16207"),
        ["data"] = new("#f1f5f9", "#475569"),
        ["header"] = new("#0f3d4c", "#0f3d4c"),
    });

    public static DiagramStyle Merge(DiagramStyle? s)
    {
        var d = Default();
        if (s is null) return d;
        var colors = new Dictionary<string, ColorPair>(d.Colors);
        foreach (var (k, v) in s.Colors ?? []) if (colors.ContainsKey(k)) colors[k] = v;
        return new(Fonts.Contains(s.Font) ? s.Font : d.Font, s.FontSize is >= 10 and <= 20 ? s.FontSize : d.FontSize, colors);
    }

    static readonly Regex Hex = new("^#[0-9a-fA-F]{6}$");

    public static string? Validate(DiagramStyle? s)
    {
        if (s is null || s.Colors is null) return "تنظیمات نامعتبر است";
        if (!Fonts.Contains(s.Font)) return "فونت نامعتبر است";
        if (s.FontSize is < 10 or > 20) return "اندازه فونت باید بین ۱۰ تا ۲۰ باشد";
        var allowed = Default().Colors.Keys;
        foreach (var (k, v) in s.Colors)
        {
            if (!allowed.Contains(k)) return "نوع عنصر نامعتبر: " + k;
            if (v is null || !Hex.IsMatch(v.Fill ?? "") || !Hex.IsMatch(v.Stroke ?? "")) return "رنگ باید به‌صورت #RRGGBB باشد";
        }
        return null;
    }

    public static async Task<DiagramStyle> Load(AppDb db)
    {
        var row = await db.Settings.AsNoTracking().FirstOrDefaultAsync(x => x.Key == Key);
        if (row is null) return Default();
        try { return Merge(JsonSerializer.Deserialize<DiagramStyle>(row.Value, JsonSerializerOptions.Web)); }
        catch (JsonException) { return Default(); }
    }
}
