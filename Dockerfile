# 1) fetch the BPMN editor bundle (pinned) so the app serves it itself: no CDN, strict CSP, faster loads
FROM node:22-alpine AS assets
WORKDIR /a
RUN npm init -y >/dev/null && npm install bpmn-js@17.11.1 vazirmatn --ignore-scripts --no-audit --no-fund
RUN mkdir -p /out/17.11.1 \
 && cp node_modules/bpmn-js/dist/bpmn-modeler.production.min.js node_modules/bpmn-js/dist/bpmn-navigated-viewer.production.min.js /out/17.11.1/ \
 && cp -r node_modules/bpmn-js/dist/assets /out/17.11.1/assets \
 && mkdir -p /out/fonts && find node_modules/vazirmatn -name 'Vazirmatn*.woff2' -exec cp {} /out/fonts/ \; \
 && ls -la /out/fonts

# 2) build the .NET app
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY api/BpmnStudio.csproj api/
RUN dotnet restore api/BpmnStudio.csproj
COPY api/ api/
COPY --from=assets /out api/wwwroot/lib
RUN dotnet publish api/BpmnStudio.csproj -c Release -o /app --no-restore

# 3) small runtime image, non-root
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_URLS=http://+:8080
USER app
EXPOSE 8080
ENTRYPOINT ["dotnet", "BpmnStudio.dll"]
