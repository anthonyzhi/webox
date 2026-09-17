package com.webox.service;

import com.webox.common.ApiException;
import com.webox.config.AppProperties;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

/**
 * Stores Console image uploads on disk.
 * <p>The stored file name is generated from a UUID and the extension is derived from the validated
 * content type — never from the client-supplied name — so a crafted upload cannot escape the upload
 * directory or land an executable extension.
 */
@Service
public class StorageService {

    private static final Logger log = LoggerFactory.getLogger(StorageService.class);
    private static final long MAX_BYTES = 5L * 1024 * 1024;
    private static final Map<String, String> ALLOWED = Map.of(
            "image/jpeg", "jpg",
            "image/png", "png",
            "image/webp", "webp");
    private static final Set<String> ALLOWED_EXTENSIONS = Set.of("jpg", "png", "webp");

    private final Path uploadDir;

    public StorageService(AppProperties properties) {
        this.uploadDir = Path.of(properties.getUploadDir()).toAbsolutePath().normalize();
        try {
            Files.createDirectories(uploadDir);
        } catch (IOException e) {
            throw new IllegalStateException("Unable to create upload directory " + uploadDir, e);
        }
    }

    public Path uploadDir() {
        return uploadDir;
    }

    public com.webox.dto.AdminDtos.UploadResponse store(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw ApiException.badRequest("VALIDATION_ERROR", "Please choose an image to upload.",
                    Map.of("file", "An image file is required."));
        }
        if (file.getSize() > MAX_BYTES) {
            throw ApiException.badRequest("VALIDATION_ERROR", "The image must be 5 MB or smaller.",
                    Map.of("file", "Maximum size is 5 MB."));
        }
        String contentType = file.getContentType() == null ? "" : file.getContentType().toLowerCase();
        String extension = ALLOWED.get(contentType);
        if (extension == null) {
            String name = file.getOriginalFilename() == null ? "" : file.getOriginalFilename().toLowerCase();
            int dot = name.lastIndexOf('.');
            String byName = dot >= 0 ? name.substring(dot + 1) : "";
            if (ALLOWED_EXTENSIONS.contains(byName)) {
                extension = byName;
            }
        }
        if (extension == null) {
            throw ApiException.badRequest("VALIDATION_ERROR", "Only JPEG, PNG or WebP images are supported.",
                    Map.of("file", "Unsupported image type."));
        }

        String storedName = UUID.randomUUID().toString().replace("-", "") + "." + extension;
        Path target = uploadDir.resolve(storedName).normalize();
        if (!target.startsWith(uploadDir)) {
            throw ApiException.badRequest("VALIDATION_ERROR", "Invalid file name.", Map.of("file", "Invalid file name."));
        }
        try (InputStream in = file.getInputStream()) {
            Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            log.error("Failed to store upload", e);
            throw new IllegalStateException("Unable to store the uploaded image.");
        }
        return new com.webox.dto.AdminDtos.UploadResponse("/uploads/" + storedName, file.getSize(), contentType);
    }
}
