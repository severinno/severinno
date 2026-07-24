Set-Location "C:\PROJETOS\$everinno__Produto"
node "node_modules\next\dist\bin\next" dev -p 3000 --webpack 2>&1 | Tee-Object -FilePath "C:\PROJETOS\$everinno__Produto\dev.log"
Read-Host -Prompt "Pressione Enter para sair"
