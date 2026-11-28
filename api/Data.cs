using Microsoft.AspNetCore.DataProtection.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;

namespace BpmnStudio;

public class User
{
    public int Id { get; set; }
    public string Username { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string Role { get; set; } = "viewer";          // viewer | designer | admin
    public bool Disabled { get; set; }
    public int FailedCount { get; set; }
    public DateTime? LockedUntil { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class Diagram
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Title { get; set; } = "";            // workflow name
    public string SystemName { get; set; } = "";       // سامانه / project
    public string Actor { get; set; } = "";            // عامل
    public string Role { get; set; } = "";             // نقش
    public string Description { get; set; } = "";
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string UpdatedBy { get; set; } = "";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public int HeadVersion { get; set; }
    public bool Archived { get; set; }
}

/// <summary>Immutable snapshot. Enforced by DB triggers: no UPDATE, no DELETE.</summary>
public class DiagramVersion
{
    public long Id { get; set; }
    public Guid DiagramId { get; set; }
    public int Number { get; set; }
    public string Xml { get; set; } = "";
    public string Message { get; set; } = "";
    public string Author { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public string ContentHash { get; set; } = "";
    public string ParentHash { get; set; } = "";
    public int Added { get; set; }
    public int Removed { get; set; }
    public int Changed { get; set; }
    public int Moved { get; set; }
    public int SizeBytes { get; set; }
}

public class VersionTag
{
    public long Id { get; set; }
    public Guid DiagramId { get; set; }
    public string Name { get; set; } = "";
    public int VersionNumber { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class ShareLink
{
    public long Id { get; set; }
    public string Token { get; set; } = "";
    public Guid DiagramId { get; set; }
    public int VersionNumber { get; set; }
    public string CreatedBy { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public bool Revoked { get; set; }
}

public class AppSetting
{
    public string Key { get; set; } = "";
    public string Value { get; set; } = "";
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public string UpdatedBy { get; set; } = "";
}

/// <summary>Append-only. Enforced by DB triggers.</summary>
public class AuditEvent
{
    public long Id { get; set; }
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    public string UserName { get; set; } = "";
    public string Action { get; set; } = "";
    public Guid? DiagramId { get; set; }
    public string? Detail { get; set; }
    public string? CorrelationId { get; set; }
    public string? IpAddress { get; set; }
}

public class UtcConverter() : ValueConverter<DateTime, DateTime>(
    v => v.ToUniversalTime(), v => DateTime.SpecifyKind(v, DateTimeKind.Utc));

public class UtcNullableConverter() : ValueConverter<DateTime?, DateTime?>(
    v => v.HasValue ? v.Value.ToUniversalTime() : v,
    v => v.HasValue ? DateTime.SpecifyKind(v.Value, DateTimeKind.Utc) : v);

public class AppDb(DbContextOptions<AppDb> options) : DbContext(options), IDataProtectionKeyContext
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Diagram> Diagrams => Set<Diagram>();
    public DbSet<DiagramVersion> Versions => Set<DiagramVersion>();
    public DbSet<VersionTag> Tags => Set<VersionTag>();
    public DbSet<ShareLink> Shares => Set<ShareLink>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();
    public DbSet<AppSetting> Settings => Set<AppSetting>();
    public DbSet<Microsoft.AspNetCore.DataProtection.EntityFrameworkCore.DataProtectionKey> DataProtectionKeys => Set<Microsoft.AspNetCore.DataProtection.EntityFrameworkCore.DataProtectionKey>();

    protected override void ConfigureConventions(ModelConfigurationBuilder c)
    {
        c.Properties<DateTime>().HaveConversion<UtcConverter>();
        c.Properties<DateTime?>().HaveConversion<UtcNullableConverter>();
    }

    protected override void OnModelCreating(ModelBuilder b)
    {
        // SQL Server cannot index nvarchar(max): every indexed text column gets an explicit length.
        b.Entity<User>().Property(x => x.Username).HasMaxLength(64);
        b.Entity<User>().Property(x => x.Role).HasMaxLength(16);
        b.Entity<User>().HasIndex(x => x.Username).IsUnique();
        b.Entity<AppSetting>().Property(x => x.Key).HasMaxLength(100);
        b.Entity<AppSetting>().HasKey(x => x.Key);
        b.Entity<Diagram>().Property(x => x.Title).HasMaxLength(120);
        b.Entity<Diagram>().Property(x => x.SystemName).HasMaxLength(80);
        b.Entity<Diagram>().Property(x => x.Actor).HasMaxLength(80);
        b.Entity<Diagram>().Property(x => x.Role).HasMaxLength(80);
        b.Entity<Diagram>().Property(x => x.Description).HasMaxLength(500);
        b.Entity<Diagram>().Property(x => x.HeadVersion).IsConcurrencyToken();
        b.Entity<Diagram>().HasIndex(x => x.SystemName);
        b.Entity<Diagram>().HasIndex(x => x.UpdatedAt);
        b.Entity<DiagramVersion>().ToTable("DiagramVersions", t => t.HasTrigger("trg_versions_immutable"));
        b.Entity<DiagramVersion>().Property(x => x.Message).HasMaxLength(200);
        b.Entity<DiagramVersion>().Property(x => x.ContentHash).HasMaxLength(64);
        b.Entity<DiagramVersion>().Property(x => x.ParentHash).HasMaxLength(64);
        b.Entity<DiagramVersion>().HasIndex(x => new { x.DiagramId, x.Number }).IsUnique();
        b.Entity<VersionTag>().Property(x => x.Name).HasMaxLength(40);
        b.Entity<VersionTag>().HasIndex(x => new { x.DiagramId, x.Name }).IsUnique();
        b.Entity<ShareLink>().Property(x => x.Token).HasMaxLength(64);
        b.Entity<ShareLink>().HasIndex(x => x.Token).IsUnique();
        b.Entity<AuditEvent>().ToTable("AuditEvents", t => t.HasTrigger("trg_audit_immutable"));
        b.Entity<AuditEvent>().Property(x => x.Action).HasMaxLength(60);
        b.Entity<AuditEvent>().HasIndex(x => x.DiagramId);
    }

    // Immutability enforced inside SQL Server: any UPDATE/DELETE on these tables is refused (even by the app login).
    public static readonly string[] HardeningSql =
    [
        "IF OBJECT_ID(N'dbo.trg_versions_immutable', N'TR') IS NULL EXEC(N'CREATE TRIGGER dbo.trg_versions_immutable ON dbo.DiagramVersions INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51000, N''versions are immutable'', 1; END');",
        "IF OBJECT_ID(N'dbo.trg_audit_immutable', N'TR') IS NULL EXEC(N'CREATE TRIGGER dbo.trg_audit_immutable ON dbo.AuditEvents INSTEAD OF UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51001, N''audit log is append-only'', 1; END');",
    ];
}

public record LoginRequest(string? Username, string? Password);
public record CreateDiagramRequest(string? Title, string? Description, string? Xml,
    [property: System.Text.Json.Serialization.JsonPropertyName("system")] string? SystemName, string? Actor, string? Role);
public record PatchDiagramRequest(string? Title, string? Description,
    [property: System.Text.Json.Serialization.JsonPropertyName("system")] string? SystemName, string? Actor, string? Role);
public record SaveVersionRequest(string? Xml, string? Message, int BaseVersion);
public record RestoreRequest(string? Message, int BaseVersion);
public record PreviewRequest(string? Xml);
public record TagRequest(string? Name, int Version);
public record ShareRequest(int Version);
public record CreateUserRequest(string? Username, string? Password, string? Role);
public record DisableRequest(bool Disabled);
public record PasswordRequest(string? Current, string? Next);
