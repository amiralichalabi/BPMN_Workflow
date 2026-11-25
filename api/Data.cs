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
    public string Title { get; set; } = "";
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

public class AppDb(DbContextOptions<AppDb> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Diagram> Diagrams => Set<Diagram>();
    public DbSet<DiagramVersion> Versions => Set<DiagramVersion>();
    public DbSet<VersionTag> Tags => Set<VersionTag>();
    public DbSet<ShareLink> Shares => Set<ShareLink>();
    public DbSet<AuditEvent> AuditEvents => Set<AuditEvent>();

    protected override void ConfigureConventions(ModelConfigurationBuilder c)
    {
        c.Properties<DateTime>().HaveConversion<UtcConverter>();
        c.Properties<DateTime?>().HaveConversion<UtcNullableConverter>();
    }

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<User>().HasIndex(x => x.Username).IsUnique();
        b.Entity<Diagram>().Property(x => x.HeadVersion).IsConcurrencyToken();
        b.Entity<Diagram>().HasIndex(x => x.UpdatedAt);
        b.Entity<DiagramVersion>().ToTable("DiagramVersions").HasIndex(x => new { x.DiagramId, x.Number }).IsUnique();
        b.Entity<VersionTag>().HasIndex(x => new { x.DiagramId, x.Name }).IsUnique();
        b.Entity<ShareLink>().HasIndex(x => x.Token).IsUnique();
        b.Entity<AuditEvent>().ToTable("AuditEvents").HasIndex(x => x.DiagramId);
    }

    public static readonly string[] HardeningSql =
    [
        "PRAGMA journal_mode=WAL;",
        "PRAGMA synchronous=NORMAL;",
        "CREATE TRIGGER IF NOT EXISTS trg_versions_no_update BEFORE UPDATE ON DiagramVersions BEGIN SELECT RAISE(ABORT,'versions are immutable'); END;",
        "CREATE TRIGGER IF NOT EXISTS trg_versions_no_delete BEFORE DELETE ON DiagramVersions BEGIN SELECT RAISE(ABORT,'versions are immutable'); END;",
        "CREATE TRIGGER IF NOT EXISTS trg_audit_no_update BEFORE UPDATE ON AuditEvents BEGIN SELECT RAISE(ABORT,'audit log is append-only'); END;",
        "CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete BEFORE DELETE ON AuditEvents BEGIN SELECT RAISE(ABORT,'audit log is append-only'); END;",
    ];
}

public record LoginRequest(string? Username, string? Password);
public record CreateDiagramRequest(string? Title, string? Description, string? Xml);
public record PatchDiagramRequest(string? Title, string? Description);
public record SaveVersionRequest(string? Xml, string? Message, int BaseVersion);
public record RestoreRequest(string? Message, int BaseVersion);
public record PreviewRequest(string? Xml);
public record TagRequest(string? Name, int Version);
public record ShareRequest(int Version);
public record CreateUserRequest(string? Username, string? Password, string? Role);
public record DisableRequest(bool Disabled);
public record PasswordRequest(string? Current, string? Next);
