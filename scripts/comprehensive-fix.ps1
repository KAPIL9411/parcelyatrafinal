# Parcel Yatra Comprehensive Fix Script
# Fixes all critical issues for production deployment

Write-Host "=== Parcel Yatra Comprehensive Fix ===" -ForegroundColor Cyan
Write-Host ""

# Check if .env exists
if (-not (Test-Path ".env")) {
    Write-Host "❌ .env file not found" -ForegroundColor Red
    Write-Host "Creating .env from .env.example..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
}

Write-Host "✅ Environment file found" -ForegroundColor Green
Write-Host ""

# Read current .env
$envContent = Get-Content ".env" -Raw

# Check critical variables
Write-Host "Checking critical configuration..." -ForegroundColor Cyan
Write-Host ""

$issues = @()
$warnings = @()

# DATABASE_URL check
if ($envContent -notmatch "DATABASE_URL=postgresql://") {
    $issues += "DATABASE_URL not configured for Neon PostgreSQL"
    Write-Host "❌ DATABASE_URL not set" -ForegroundColor Red
    Write-Host "   Get from: https://console.neon.tech -> Connection Details" -ForegroundColor Yellow
} else {
    Write-Host "✅ DATABASE_URL configured" -ForegroundColor Green
}

# Google OAuth check
if ($envContent -match "GOOGLE_OAUTH_ENABLED=false") {
    $warnings += "Google OAuth is disabled"
    Write-Host "⚠️  Google OAuth disabled" -ForegroundColor Yellow
} elseif ($envContent -match "GOOGLE_CLIENT_ID=(CHANGE_ME|your_google)" -or
          $envContent -match "GOOGLE_CLIENT_SECRET=(CHANGE_ME|your_google)") {
    $issues += "Google OAuth credentials not configured"
    Write-Host "❌ Google OAuth credentials not set" -ForegroundColor Red
    Write-Host "   Get from: https://console.cloud.google.com -> APIs & Services" -ForegroundColor Yellow
} else {
    Write-Host "✅ Google OAuth configured" -ForegroundColor Green
}

# Cloudinary check
if ($envContent -match "STORAGE_PROVIDER=cloudinary") {
    if ($envContent -match "CLOUDINARY_CLOUD_NAME=(CHANGE_ME|your_)" -or
        $envContent -match "CLOUDINARY_API_KEY=(CHANGE_ME|your_)") {
        $warnings += "Cloudinary not configured"
        Write-Host "⚠️  Cloudinary not configured" -ForegroundColor Yellow
        Write-Host "   Get from: https://cloudinary.com -> Dashboard" -ForegroundColor Yellow
    } else {
        Write-Host "✅ Cloudinary configured" -ForegroundColor Green
    }
}

# Dev endpoints check
if ($envContent -match "ENABLE_DEV_ENDPOINTS=true") {
    $warnings += "Dev endpoints enabled (test mode will show)"
    Write-Host "⚠️  Dev endpoints enabled (test mode banners will show)" -ForegroundColor Yellow
} else {
    Write-Host "✅ Dev endpoints disabled (production mode)" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Test Database Connection ===" -ForegroundColor Cyan
Write-Host ""

if ($envContent -match "DATABASE_URL=postgresql://") {
    Write-Host "Testing database connection..." -ForegroundColor Yellow
    try {
        node scripts/test-db.js
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Database connection successful" -ForegroundColor Green
        } else {
            Write-Host "❌ Database connection failed" -ForegroundColor Red
            $issues += "Database connection test failed"
        }
    } catch {
        Write-Host "⚠️  Could not run database test" -ForegroundColor Yellow
        $warnings += "Database test skipped"
    }
} else {
    Write-Host "⏭️  Skipping database test (DATABASE_URL not set)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== Run TypeScript Check ===" -ForegroundColor Cyan
Write-Host ""

npm run typecheck
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ TypeScript check passed" -ForegroundColor Green
} else {
    Write-Host "❌ TypeScript errors found" -ForegroundColor Red
    $issues += "TypeScript compilation errors"
}

Write-Host ""
Write-Host "=== Run Tests ===" -ForegroundColor Cyan
Write-Host ""

npm test
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ All tests passed" -ForegroundColor Green
} else {
    Write-Host "❌ Some tests failed" -ForegroundColor Red
    $issues += "Test failures"
}

Write-Host ""
Write-Host "=== Build Check ===" -ForegroundColor Cyan
Write-Host ""

npm run build
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Build successful" -ForegroundColor Green
} else {
    Write-Host "❌ Build failed" -ForegroundColor Red
    $issues += "Build errors"
}

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host ""

if ($issues.Count -eq 0) {
    Write-Host "✅ No critical issues found!" -ForegroundColor Green
} else {
    Write-Host "❌ Critical Issues ($($issues.Count)):" -ForegroundColor Red
    foreach ($issue in $issues) {
        Write-Host "   - $issue" -ForegroundColor Red
    }
}

if ($warnings.Count -gt 0) {
    Write-Host ""
    Write-Host "⚠️  Warnings ($($warnings.Count)):" -ForegroundColor Yellow
    foreach ($warning in $warnings) {
        Write-Host "   - $warning" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "=== Next Steps ===" -ForegroundColor Cyan
Write-Host ""

if ($issues.Count -gt 0) {
    Write-Host "Fix critical issues before deploying:" -ForegroundColor Yellow
    Write-Host "1. Configure DATABASE_URL in .env"
    Write-Host "2. Set up Google OAuth credentials"
    Write-Host "3. Run: node scripts/setup-neon.js"
    Write-Host "4. Re-run this script to verify"
} else {
    Write-Host "Ready to deploy!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Development:" -ForegroundColor Cyan
    Write-Host "  npm run dev"
    Write-Host ""
    Write-Host "Production:" -ForegroundColor Cyan
    Write-Host "  Deploy to Render (API)"
    Write-Host "  Deploy to Vercel (Web)"
    Write-Host ""
    Write-Host "See PRODUCTION_SETUP_GUIDE.md for details"
}

Write-Host ""
