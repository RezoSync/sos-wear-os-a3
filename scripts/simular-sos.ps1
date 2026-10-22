param(
    [string]$Url = "http://localhost:3000",
    [string]$Nombre = "Usuario simulado",
    [int]$Puntos = 20,
    [int]$Intervalo = 3,
    [ValidateSet("manual", "voz", "pulso", "carrera")]
    [string]$Trigger = "manual"
)

$ErrorActionPreference = "Stop"
$baseUrl = $Url.TrimEnd("/")
$epoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$id = "sim-$epoch"
$latitudBase = 32.43786
$longitudBase = -114.71728
$sosCreado = $false
$exitCode = 0

try {
    $timestamp = [DateTime]::UtcNow.ToString("o")
    $sos = @{
        id = $id
        name = $Nombre
        trigger = $Trigger
        lat = $latitudBase
        lng = $longitudBase
        timestamp = $timestamp
    }
    $body = $sos | ConvertTo-Json -Compress
    Write-Host "Enviando POST /api/sos: $body"
    Invoke-RestMethod -Method Post -Uri "$baseUrl/api/sos" -ContentType "application/json" -Body $body | Out-Null
    $sosCreado = $true

    for ($paso = 1; $paso -le $Puntos; $paso++) {
        if ($Intervalo -gt 0) {
            Start-Sleep -Seconds $Intervalo
        }

        $ubicacion = @{
            lat = $latitudBase + ($paso * 0.00008)
            lng = $longitudBase + ($paso * 0.00008)
            accuracy = 8
            timestamp = [DateTime]::UtcNow.ToString("o")
        }
        $body = $ubicacion | ConvertTo-Json -Compress
        Write-Host "Enviando POST /api/sos/$id/location ($paso/$Puntos): $body"
        Invoke-RestMethod -Method Post -Uri "$baseUrl/api/sos/$id/location" -ContentType "application/json" -Body $body | Out-Null
    }

    Write-Host "Enviando POST /api/sos/$id/cancel"
    Invoke-RestMethod -Method Post -Uri "$baseUrl/api/sos/$id/cancel" | Out-Null
    $sosCreado = $false
    Write-Host "Simulación finalizada."
}
catch [System.Management.Automation.PipelineStoppedException] {
    Write-Host "`nSimulación detenida por el usuario."
}
catch {
    Write-Host "No se pudo completar la simulación: $($_.Exception.Message)" -ForegroundColor Red
    $exitCode = 1
}
finally {
    if ($sosCreado) {
        try {
            Write-Host "Cancelando el SOS simulado..."
            Invoke-RestMethod -Method Post -Uri "$baseUrl/api/sos/$id/cancel" | Out-Null
        }
        catch {
            Write-Host "No se pudo cancelar el SOS simulado: $($_.Exception.Message)" -ForegroundColor Yellow
            $exitCode = 1
        }
    }
}

if ($exitCode -ne 0) {
    exit $exitCode
}
