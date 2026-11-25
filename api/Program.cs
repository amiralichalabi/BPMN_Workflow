using System.Buffers.Text;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using System.Threading.RateLimiting;
using BpmnStudio;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

var builder = WebApplication.CreateBuilder(args);
var dataDir = builder.Configuration["DataDir"] ?? "/data";
Directory.CreateDirectory(dataDir);
var behindProxy = builder.Configuration.GetValue<bool>("BehindProxy");

builder.Services.AddDbContext<AppDb>(o => o.UseSqlite($"Data Source={Path.Combine(dataDir, "studio.db")}"));
builder.Services.AddDataProtection().PersistKeysToFileSystem(new DirectoryInfo(Path.Combine(dataDir, "keys")));
builder.Services.AddMemoryCache();
builder.Services.AddResponseCompression(o =>
{
    o.EnableForHttps = true;
    o.MimeTypes = ResponseCompressionDefaults.MimeTypes.Concat(["image/svg+xml", "application/xml", "text/css", "text/javascript"]);
});
if (behindProxy)
    builder.Services.Configure<ForwardedHeadersOptions>(o =>
    {
        o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
        o.KnownNetworks.Clear();
        o.KnownProxies.Clear();
    });

builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme).AddCookie(o =>
{
    o.Cookie.Name = "studio.sid";
    o.Cookie.HttpOnly = true;
    o.Cookie.SameSite = SameSiteMode.Strict;
    o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest;
    o.ExpireTimeSpan = TimeSpan.FromHours(8);
    o.SlidingExpiration = true;
    o.Events.OnRedirectToLogin = c => { c.Response.StatusCode = 401; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = c => { c.Response.StatusCode = 403; return Task.CompletedTask; };
    // Fast revocation: a disabled user or changed role is rejected within seconds (or immediately, cache is cleared on change).
    o.Events.OnValidatePrincipal = async c =>
    {
        if (!int.TryParse(c.Principal?.FindFirstValue("uid"), out var uid)) { c.RejectPrincipal(); await c.HttpContext.SignOutAsync(); return; }
        var cache = c.HttpContext.RequestServices.GetRequiredService<IMemoryCache>();
        if (!cache.TryGetValue("u:" + uid, out string? state))
        {
            var db = c.HttpContext.RequestServices.GetRequiredService<AppDb>();
            var u = await db.Users.AsNoTracking().Where(x => x.Id == uid).Select(x => new { x.Disabled, x.Role }).FirstOrDefaultAsync();
            state = u is null || u.Disabled ? "off" : u.Role;
            cache.Set("u:" + uid, state, TimeSpan.FromSeconds(20));
        }
        if (state == "off" || state != c.Principal!.FindFirstValue(ClaimTypes.Role))
        {
            c.RejectPrincipal();
            await c.HttpContext.SignOutAsync();
        }
    };
});
// Secure by default: every endpoint requires a signed-in user unless it says AllowAnonymous.
builder.Services.AddAuthorizationBuilder()
    .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build())
    .AddPolicy("Designer", p => p.RequireRole("designer", "admin"))
    .AddPolicy("Admin", p => p.RequireRole("admin"));
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = 429;
    o.AddPolicy("login", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 10, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
    o.AddPolicy("public", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 60, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});

var app = builder.Build();

// ---------- DB init + first admin ----------
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDb>();
    await db.Database.EnsureCreatedAsync();
    foreach (var sql in AppDb.HardeningSql) await db.Database.ExecuteSqlRawAsync(sql);
    if (!await db.Users.AnyAsync())
    {
        var configured = builder.Configuration["AdminPassword"];
        if (configured is { Length: > 0 and < 10 }) throw new InvalidOperationException("AdminPassword must be at least 10 characters.");
        var pw = string.IsNullOrEmpty(configured) ? RandomPassword() : configured;
        db.Users.Add(new User { Username = "admin", PasswordHash = Pw.Hash(pw), Role = "admin" });
        await db.SaveChangesAsync();
        if (string.IsNullOrEmpty(configured))
            app.Logger.LogWarning("INITIAL ADMIN PASSWORD (shown once) -> username: admin  password: {Password}", pw);
    }
}

// ---------- middleware ----------
if (behindProxy) app.UseForwardedHeaders();
app.UseResponseCompression();
app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h["X-Content-Type-Options"] = "nosniff";
    h["X-Frame-Options"] = "DENY";
    h["Referrer-Policy"] = "no-referrer";
    h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
    h["Content-Security-Policy"] = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
    if (ctx.Request.Path.StartsWithSegments("/api"))
    {
        h["Cache-Control"] = "no-store";
        var m = ctx.Request.Method;
        if (!(HttpMethods.IsGet(m) || HttpMethods.IsHead(m) || HttpMethods.IsOptions(m)))
        {
            // CSRF defence in depth (cookie is SameSite=Strict): custom header + same-origin check.
            if (ctx.Request.Headers["X-Studio"] != "1") { ctx.Response.StatusCode = 400; return; }
            var origin = ctx.Request.Headers.Origin.ToString();
            if (origin.Length > 0 && (!Uri.TryCreate(origin, UriKind.Absolute, out var ou) || ou.Authority != ctx.Request.Host.Value))
            { ctx.Response.StatusCode = 403; return; }
        }
    }
    await next();
});
app.UseRateLimiter();
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = c =>
    {
        // versioned third-party bundle: cache for a year; our own files: always revalidate (ETag)
        c.Context.Response.Headers.CacheControl = c.Context.Request.Path.StartsWithSegments("/lib")
            ? "public,max-age=31536000,immutable" : "no-cache";
    }
});
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous();

// ---------- auth ----------
app.MapPost("/api/auth/login", async (LoginRequest req, HttpContext ctx, AppDb db) =>
{
    var name = (req.Username ?? "").Trim().ToLowerInvariant();
    var u = await db.Users.FirstOrDefaultAsync(x => x.Username == name);
    if (u?.LockedUntil > DateTime.UtcNow)
    {
        await Audit.Log(db, ctx, "login_locked", user: name);
        return Api.Err(429, "حساب به‌دلیل تلاش‌های ناموفق موقتاً قفل شده است؛ چند دقیقه بعد دوباره تلاش کنید");
    }
    var ok = Pw.Verify(req.Password ?? "", u?.PasswordHash ?? Pw.Dummy) && u is { Disabled: false };
    if (!ok)
    {
        if (u != null)
        {
            u.FailedCount++;
            if (u.FailedCount >= 5) { u.LockedUntil = DateTime.UtcNow.AddMinutes(10); u.FailedCount = 0; }
            await db.SaveChangesAsync();
        }
        await Audit.Log(db, ctx, "login_failed", user: name.Length == 0 ? "anonymous" : name);
        return Api.Err(401, "نام کاربری یا رمز عبور نادرست است");
    }
    u!.FailedCount = 0;
    u.LockedUntil = null;
    await db.SaveChangesAsync();
    var identity = new ClaimsIdentity(
        [new Claim(ClaimTypes.Name, u.Username), new Claim(ClaimTypes.Role, u.Role), new Claim("uid", u.Id.ToString())],
        CookieAuthenticationDefaults.AuthenticationScheme);
    await ctx.SignInAsync(new ClaimsPrincipal(identity));
    await Audit.Log(db, ctx, "login", user: u.Username);
    return Results.Ok(new { username = u.Username, role = u.Role });
}).AllowAnonymous().RequireRateLimiting("login");

app.MapPost("/api/auth/logout", async (HttpContext ctx) => { await ctx.SignOutAsync(); return Results.Ok(); });

app.MapGet("/api/auth/me", (ClaimsPrincipal p) =>
    Results.Ok(new { username = p.Identity!.Name, role = p.FindFirstValue(ClaimTypes.Role) }));

app.MapPost("/api/auth/password", async (PasswordRequest req, HttpContext ctx, AppDb db) =>
{
    var uid = int.Parse(ctx.User.FindFirstValue("uid")!);
    var u = await db.Users.FirstAsync(x => x.Id == uid);
    if (!Pw.Verify(req.Current ?? "", u.PasswordHash)) return Api.Err(400, "رمز فعلی نادرست است");
    if ((req.Next ?? "").Length < 10) return Api.Err(400, "رمز جدید باید حداقل ۱۰ نویسه باشد");
    u.PasswordHash = Pw.Hash(req.Next!);
    await db.SaveChangesAsync();
    await Audit.Log(db, ctx, "password_changed");
    return Results.Ok();
});

// ---------- users (admin) ----------
app.MapGet("/api/users", async (AppDb db) =>
    Results.Ok(await db.Users.AsNoTracking().OrderBy(u => u.Username)
        .Select(u => new { u.Id, u.Username, u.Role, u.Disabled, u.CreatedAt }).ToListAsync()))
    .RequireAuthorization("Admin");

app.MapPost("/api/users", async (CreateUserRequest req, HttpContext ctx, AppDb db) =>
{
    var name = (req.Username ?? "").Trim().ToLowerInvariant();
    if (!Regex.IsMatch(name, "^[a-z0-9._-]{3,32}$")) return Api.Err(400, "نام کاربری باید ۳ تا ۳۲ نویسه انگلیسی/عدد باشد");
    if ((req.Password ?? "").Length < 10) return Api.Err(400, "رمز عبور باید حداقل ۱۰ نویسه باشد");
    if (req.Role is not ("viewer" or "designer" or "admin")) return Api.Err(400, "نقش نامعتبر است");
    if (await db.Users.AnyAsync(x => x.Username == name)) return Api.Err(409, "این نام کاربری قبلاً وجود دارد");
    db.Users.Add(new User { Username = name, PasswordHash = Pw.Hash(req.Password!), Role = req.Role });
    await db.SaveChangesAsync();
    await Audit.Log(db, ctx, "user_created", detail: new { name, req.Role });
    return Results.Ok();
}).RequireAuthorization("Admin");

app.MapPost("/api/users/{id:int}/disabled", async (int id, DisableRequest req, HttpContext ctx, AppDb db, IMemoryCache cache) =>
{
    if (id.ToString() == ctx.User.FindFirstValue("uid")) return Api.Err(400, "نمی‌توانید حساب خودتان را غیرفعال کنید");
    var u = await db.Users.FirstOrDefaultAsync(x => x.Id == id);
    if (u is null) return Api.Err(404, "کاربر یافت نشد");
    u.Disabled = req.Disabled;
    await db.SaveChangesAsync();
    cache.Remove("u:" + id);
    await Audit.Log(db, ctx, req.Disabled ? "user_disabled" : "user_enabled", detail: new { u.Username });
    return Results.Ok();
}).RequireAuthorization("Admin");

app.MapGet("/api/audit", async (AppDb db) =>
    Results.Ok(await db.AuditEvents.AsNoTracking().OrderByDescending(a => a.Id).Take(300).ToListAsync()))
    .RequireAuthorization("Admin");

// ---------- diagrams ----------
app.MapGet("/api/diagrams", async (string? q, AppDb db) =>
{
    var query = db.Diagrams.AsNoTracking().Where(d => !d.Archived);
    if (!string.IsNullOrWhiteSpace(q))
    {
        var like = $"%{q.Trim().Replace("%", "").Replace("_", "")}%";
        query = query.Where(d => EF.Functions.Like(d.Title, like) || EF.Functions.Like(d.Description, like));
    }
    var rows = await query.OrderByDescending(d => d.UpdatedAt).Take(200).ToListAsync();
    return Results.Ok(rows.Select(Dto));
});

app.MapPost("/api/diagrams", async (CreateDiagramRequest req, HttpContext ctx, AppDb db) =>
{
    var title = (req.Title ?? "").Trim();
    if (title.Length is 0 or > 120) return Api.Err(400, "عنوان نمودار الزامی است (حداکثر ۱۲۰ نویسه)");
    var xml = string.IsNullOrWhiteSpace(req.Xml) ? XmlGuard.Blank() : req.Xml;
    if (XmlGuard.Validate(xml) is { } err) return Api.Err(400, err);
    var user = Api.UserName(ctx);
    var d = new Diagram
    {
        Title = title,
        Description = (req.Description ?? "").Trim()[..Math.Min(500, (req.Description ?? "").Trim().Length)],
        CreatedBy = user, UpdatedBy = user, HeadVersion = 1
    };
    db.Diagrams.Add(d);
    db.Versions.Add(new DiagramVersion
    {
        DiagramId = d.Id, Number = 1, Xml = xml, Message = "ایجاد نمودار", Author = user,
        ContentHash = XmlGuard.Hash(xml), ParentHash = "", SizeBytes = xml.Length
    });
    await db.SaveChangesAsync();
    await Audit.Log(db, ctx, "diagram_created", d.Id, new { title });
    return Results.Ok(Dto(d));
}).RequireAuthorization("Designer");

app.MapGet("/api/diagrams/{id:guid}", async (Guid id, AppDb db) =>
{
    var d = await db.Diagrams.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
    return d is null ? Api.Err(404, "نمودار یافت نشد") : Results.Ok(Dto(d));
});

app.MapPatch("/api/diagrams/{id:guid}", async (Guid id, PatchDiagramRequest req, HttpContext ctx, AppDb db) =>
{
    var d = await db.Diagrams.FirstOrDefaultAsync(x => x.Id == id);
    if (d is null) return Api.Err(404, "نمودار یافت نشد");
    var title = (req.Title ?? d.Title).Trim();
    if (title.Length is 0 or > 120) return Api.Err(400, "عنوان نامعتبر است");
    d.Title = title;
    if (req.Description != null) d.Description = req.Description.Trim()[..Math.Min(500, req.Description.Trim().Length)];
    await db.SaveChangesAsync();
    await Audit.Log(db, ctx, "diagram_renamed", id, new { title });
    return Results.Ok(Dto(d));
}).RequireAuthorization("Designer");

app.MapPost("/api/diagrams/{id:guid}/archive", async (Guid id, HttpContext ctx, AppDb db) =>
{
    var d = await db.Diagrams.FirstOrDefaultAsync(x => x.Id == id);
    if (d is null) return Api.Err(404, "نمودار یافت نشد");
    d.Archived = true;   // never deleted: history stays intact
    await db.SaveChangesAsync();
    await Audit.Log(db, ctx, "diagram_archived", id);
    return Results.Ok();
}).RequireAuthorization("Designer");

// ---------- versions (the git-like part) ----------
app.MapGet("/api/diagrams/{id:guid}/versions", async (Guid id, AppDb db) =>
{
    var vs = await db.Versions.AsNoTracking().Where(v => v.DiagramId == id).OrderByDescending(v => v.Number)
        .Select(v => new { v.Number, v.Message, v.Author, v.CreatedAt, v.ContentHash, v.Added, v.Removed, v.Changed, v.Moved, v.SizeBytes })
        .ToListAsync();   // Xml column is NOT loaded here: keeps the list fast
    var tags = await db.Tags.AsNoTracking().Where(t => t.DiagramId == id).ToListAsync();
    return Results.Ok(vs.Select(v => new
    {
        number = v.Number, message = v.Message, author = v.Author, createdAt = v.CreatedAt,
        hash = v.ContentHash[..8], added = v.Added, removed = v.Removed, changed = v.Changed, moved = v.Moved,
        sizeBytes = v.SizeBytes, tags = tags.Where(t => t.VersionNumber == v.Number).Select(t => t.Name)
    }));
});

app.MapGet("/api/diagrams/{id:guid}/versions/{n:int}", async (Guid id, int n, AppDb db) =>
{
    var v = await db.Versions.AsNoTracking().FirstOrDefaultAsync(x => x.DiagramId == id && x.Number == n);
    if (v is null) return Api.Err(404, "نسخه یافت نشد");
    return Results.Ok(new { number = v.Number, message = v.Message, author = v.Author, createdAt = v.CreatedAt, hash = v.ContentHash[..8], xml = v.Xml });
});

app.MapPost("/api/diagrams/{id:guid}/versions", (Guid id, SaveVersionRequest req, HttpContext ctx, AppDb db) =>
    Commit(db, ctx, id, req.Xml, req.Message, req.BaseVersion, "version_saved"))
    .RequireAuthorization("Designer");

app.MapPost("/api/diagrams/{id:guid}/versions/{n:int}/restore", async (Guid id, int n, RestoreRequest req, HttpContext ctx, AppDb db) =>
{
    var src = await db.Versions.AsNoTracking().FirstOrDefaultAsync(x => x.DiagramId == id && x.Number == n);
    if (src is null) return Api.Err(404, "نسخه یافت نشد");
    var msg = string.IsNullOrWhiteSpace(req.Message) ? $"بازگردانی به نسخه {n}" : req.Message;
    return await Commit(db, ctx, id, src.Xml, msg, req.BaseVersion, "version_restored");
}).RequireAuthorization("Designer");

// What would change if I saved now? (shown in the save dialog)
app.MapPost("/api/diagrams/{id:guid}/preview", async (Guid id, PreviewRequest req, AppDb db) =>
{
    if (XmlGuard.Validate(req.Xml) is { } err) return Api.Err(400, err);
    var d = await db.Diagrams.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
    if (d is null) return Api.Err(404, "نمودار یافت نشد");
    var head = await db.Versions.AsNoTracking().FirstAsync(v => v.DiagramId == id && v.Number == d.HeadVersion);
    return Results.Ok(new { headVersion = d.HeadVersion, items = BpmnDiff.Compare(head.Xml, req.Xml!) });
}).RequireAuthorization("Designer");

app.MapGet("/api/diagrams/{id:guid}/diff", async (Guid id, int from, int to, AppDb db) =>
{
    var vs = await db.Versions.AsNoTracking().Where(v => v.DiagramId == id && (v.Number == from || v.Number == to)).ToListAsync();
    var a = vs.FirstOrDefault(v => v.Number == from);
    var b = vs.FirstOrDefault(v => v.Number == to);
    if (a is null || b is null) return Api.Err(404, "نسخه یافت نشد");
    return Results.Ok(new { from, to, fromXml = a.Xml, toXml = b.Xml, items = BpmnDiff.Compare(a.Xml, b.Xml) });
});

// ---------- tags ----------
app.MapPost("/api/diagrams/{id:guid}/tags", async (Guid id, TagRequest req, HttpContext ctx, AppDb db) =>
{
    var name = (req.Name ?? "").Trim();
    if (!Regex.IsMatch(name, @"^[\p{L}\p{N}_\-. ]{1,40}$")) return Api.Err(400, "نام برچسب نامعتبر است");
    if (!await db.Versions.AnyAsync(v => v.DiagramId == id && v.Number == req.Version)) return Api.Err(404, "نسخه یافت نشد");
    if (await db.Tags.AnyAsync(t => t.DiagramId == id && t.Name == name)) return Api.Err(409, "این برچسب قبلاً روی نسخه‌ای گذاشته شده است");
    db.Tags.Add(new VersionTag { DiagramId = id, Name = name, VersionNumber = req.Version, CreatedBy = Api.UserName(ctx) });
    await db.SaveChangesAsync();
    await Audit.Log(db, ctx, "tag_created", id, new { name, req.Version });
    return Results.Ok();
}).RequireAuthorization("Designer");

app.MapDelete("/api/diagrams/{id:guid}/tags/{name}", async (Guid id, string name, HttpContext ctx, AppDb db) =>
{
    var t = await db.Tags.FirstOrDefaultAsync(x => x.DiagramId == id && x.Name == name);
    if (t is null) return Api.Err(404, "برچسب یافت نشد");
    db.Tags.Remove(t);
    await db.SaveChangesAsync();
    await Audit.Log(db, ctx, "tag_deleted", id, new { name });
    return Results.Ok();
}).RequireAuthorization("Designer");

// ---------- share links (read-only poster) ----------
app.MapGet("/api/diagrams/{id:guid}/shares", async (Guid id, AppDb db) =>
    Results.Ok(await db.Shares.AsNoTracking().Where(s => s.DiagramId == id).OrderByDescending(s => s.Id)
        .Select(s => new { s.Id, s.Token, s.VersionNumber, s.CreatedBy, s.CreatedAt, s.Revoked }).ToListAsync()))
    .RequireAuthorization("Designer");

app.MapPost("/api/diagrams/{id:guid}/shares", async (Guid id, ShareRequest req, HttpContext ctx, AppDb db) =>
{
    if (!await db.Versions.AnyAsync(v => v.DiagramId == id && v.Number == req.Version)) return Api.Err(404, "نسخه یافت نشد");
    var token = Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(24));
    db.Shares.Add(new ShareLink { Token = token, DiagramId = id, VersionNumber = req.Version, CreatedBy = Api.UserName(ctx) });
    await db.SaveChangesAsync();
    await Audit.Log(db, ctx, "share_created", id, new { req.Version });
    return Results.Ok(new { token });
}).RequireAuthorization("Designer");

app.MapPost("/api/shares/{shareId:long}/revoke", async (long shareId, HttpContext ctx, AppDb db) =>
{
    var s = await db.Shares.FirstOrDefaultAsync(x => x.Id == shareId);
    if (s is null) return Api.Err(404, "پیوند یافت نشد");
    s.Revoked = true;
    await db.SaveChangesAsync();
    await Audit.Log(db, ctx, "share_revoked", s.DiagramId);
    return Results.Ok();
}).RequireAuthorization("Designer");

app.MapGet("/api/public/{token}", async (string token, HttpContext ctx, AppDb db) =>
{
    ctx.Response.Headers["X-Robots-Tag"] = "noindex";
    if (token.Length > 64) return Api.Err(404, "پیوند معتبر نیست یا لغو شده است");
    var s = await db.Shares.AsNoTracking().FirstOrDefaultAsync(x => x.Token == token && !x.Revoked);
    if (s is null) return Api.Err(404, "پیوند معتبر نیست یا لغو شده است");
    var d = await db.Diagrams.AsNoTracking().FirstAsync(x => x.Id == s.DiagramId);
    var v = await db.Versions.AsNoTracking().FirstAsync(x => x.DiagramId == s.DiagramId && x.Number == s.VersionNumber);
    return Results.Ok(new { title = d.Title, number = v.Number, createdAt = v.CreatedAt, author = v.Author, hash = v.ContentHash[..8], xml = v.Xml });
}).AllowAnonymous().RequireRateLimiting("public");

app.Run();

// ---------- helpers ----------
static object Dto(Diagram d) => new
{
    id = d.Id, title = d.Title, description = d.Description, headVersion = d.HeadVersion,
    createdBy = d.CreatedBy, createdAt = d.CreatedAt, updatedBy = d.UpdatedBy, updatedAt = d.UpdatedAt
};

static string RandomPassword()
{
    const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    return new string(Enumerable.Range(0, 18).Select(_ => chars[RandomNumberGenerator.GetInt32(chars.Length)]).ToArray());
}

// Creates version head+1 from xml. Rejects stale saves (optimistic concurrency) and empty commits.
static async Task<IResult> Commit(AppDb db, HttpContext ctx, Guid id, string? xml, string? message, int baseVersion, string action)
{
    var d = await db.Diagrams.FirstOrDefaultAsync(x => x.Id == id);
    if (d is null) return Api.Err(404, "نمودار یافت نشد");
    if (d.Archived) return Api.Err(409, "این نمودار بایگانی شده است");
    if (d.HeadVersion != baseVersion)
        return Results.Json(new { error = $"در این فاصله نسخه v{d.HeadVersion} توسط شخص دیگری ثبت شده است", headVersion = d.HeadVersion }, statusCode: 409);
    if (XmlGuard.Validate(xml) is { } err) return Api.Err(400, err);

    var head = await db.Versions.AsNoTracking().FirstAsync(v => v.DiagramId == id && v.Number == d.HeadVersion);
    var hash = XmlGuard.Hash(xml!);
    if (hash == head.ContentHash) return Results.Ok(new { unchanged = true, version = head.Number });

    var items = BpmnDiff.Compare(head.Xml, xml!);
    var msg = (message ?? "").Trim();
    if (msg.Length == 0) msg = "ذخیره تغییرات";
    var user = Api.UserName(ctx);
    var v = new DiagramVersion
    {
        DiagramId = id, Number = d.HeadVersion + 1, Xml = xml!, Message = msg[..Math.Min(200, msg.Length)], Author = user,
        ContentHash = hash, ParentHash = head.ContentHash, SizeBytes = xml!.Length,
        Added = items.Count(i => i.Kind == "added"), Removed = items.Count(i => i.Kind == "removed"),
        Changed = items.Count(i => i.Kind == "changed"), Moved = items.Count(i => i.Kind == "moved")
    };
    db.Versions.Add(v);
    d.HeadVersion = v.Number;
    d.UpdatedAt = DateTime.UtcNow;
    d.UpdatedBy = user;
    try { await db.SaveChangesAsync(); }
    catch (DbUpdateException)
    {
        return Api.Err(409, "هم‌زمان نسخه دیگری ثبت شد؛ صفحه را دوباره بارگذاری کنید");
    }
    await Audit.Log(db, ctx, action, id, new { version = v.Number, message = v.Message });
    return Results.Ok(new { unchanged = false, version = v.Number, hash = hash[..8], added = v.Added, removed = v.Removed, changed = v.Changed, moved = v.Moved });
}
