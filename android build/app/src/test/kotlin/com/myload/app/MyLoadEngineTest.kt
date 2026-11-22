package com.myload.app

import com.myload.app.engine.BencodeParser
import com.myload.app.engine.GitHubUpdateChecker
import com.myload.app.engine.HttpDownloadEngine
import com.myload.app.model.DownloadKind
import com.myload.app.model.FileCategory
import com.myload.app.model.FormatUtils
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class MyLoadEngineTest {
  @Test
  fun buildsMultiSegmentsUpTo32AndFallsBackWhenNotResumable() {
    val segments16 = HttpDownloadEngine.buildInitialSegments(
      totalBytes = 16L * 1024L * 1024L,
      resumeSupported = true,
      requestedConnections = 16,
    )
    assertEquals(16, segments16.size)
    assertEquals(0L, segments16.first().start)
    assertEquals((16L * 1024L * 1024L) - 1L, segments16.last().end)

    val segments32 = HttpDownloadEngine.buildInitialSegments(
      totalBytes = 64L * 1024L * 1024L,
      resumeSupported = true,
      requestedConnections = 32,
    )
    assertEquals(32, segments32.size)

    val single = HttpDownloadEngine.buildInitialSegments(
      totalBytes = 64L * 1024L * 1024L,
      resumeSupported = false,
      requestedConnections = 16,
    )
    assertEquals(1, single.size)
  }

  @Test
  fun parsesMagnetAndMultiFileTorrentBencodeAndResolvesTargetPaths() {
    val magnet =
      "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Ubuntu%20ISO&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337"
    val probe = BencodeParser.parseMagnetUri(magnet)
    assertEquals(DownloadKind.TORRENT, probe.kind)
    assertEquals("Ubuntu ISO", probe.fileName)
    assertEquals("0123456789abcdef0123456789abcdef01234567", probe.infoHash)
    assertTrue(probe.trackers.isNotEmpty())

    val bencoded =
      "d8:announce37:udp://tracker.example.com:80/announce4:infod5:filesld6:lengthi1024e4:pathl9:disc1.isoeeed6:lengthi2048e4:pathl6:extras10:readme.txteee4:name11:ReleasePack12:piece lengthi262144eee"
        .replace("isoeee", "isoee")
        .toByteArray(Charsets.UTF_8)
    val parsed = BencodeParser.parseTorrentBytes(bencoded, "fallback")
    assertEquals("ReleasePack", parsed.name)
    assertEquals(3072L, parsed.totalBytes)
    assertEquals(2, parsed.files.size)
    assertEquals("ReleasePack/disc1.iso", parsed.files[0].path)
    assertEquals("ReleasePack/extras/readme.txt", parsed.files[1].path)

    val tmpDir = Files.createTempDirectory("myload-android-test").toFile()
    try {
      val singleResolved = BencodeParser.resolveTorrentTargetPath(
        saveDir = tmpDir.absolutePath,
        torrentName = "ubuntu.iso",
        filePaths = listOf("ubuntu.iso"),
        fallbackName = "fallback",
      )
      assertEquals(File(tmpDir, "ubuntu.iso").canonicalPath, singleResolved)

      val folderResolved = BencodeParser.resolveTorrentTargetPath(
        saveDir = tmpDir.absolutePath,
        torrentName = "ReleasePack",
        filePaths = parsed.files.map { it.path },
        fallbackName = "fallback",
      )
      assertEquals(File(tmpDir, "ReleasePack").canonicalPath, folderResolved)
    } finally {
      tmpDir.deleteRecursively()
    }
  }

  @Test
  fun comparesSemverAndCleansUpTempUpdatePackages() {
    assertEquals(1, GitHubUpdateChecker.compareSemver("v1.0.13", "1.0.12"))
    assertEquals(0, GitHubUpdateChecker.compareSemver("v1.0.12", "1.0.12"))
    assertEquals(-1, GitHubUpdateChecker.compareSemver("1.0.1", "1.0.12"))

    val tmpCache = Files.createTempDirectory("myload-cache-test").toFile()
    try {
      val updatesDir = File(tmpCache, "MyLoad-Updates").apply { mkdirs() }
      val staleApk = File(updatesDir, "MyLoad-1.0.1.apk").apply { writeText("apk") }
      val stalePart = File(updatesDir, "MyLoad-1.0.12.apk.part").apply { writeText("part") }
      val keepTxt = File(updatesDir, "notes.txt").apply { writeText("keep") }

      val removed = GitHubUpdateChecker.cleanupOldUpdateFiles(tmpCache)
      assertEquals(2, removed)
      assertFalse(staleApk.exists())
      assertFalse(stalePart.exists())
      assertTrue(keepTxt.exists())
    } finally {
      tmpCache.deleteRecursively()
    }
  }

  @Test
  fun classifiesCategoriesAndExtractsBatchUrls() {
    assertEquals(FileCategory.ARCHIVES, FormatUtils.classifyFileName("archive.part01.rar", DownloadKind.HTTP))
    assertEquals(FileCategory.VIDEOS, FormatUtils.classifyFileName("movie.mkv", DownloadKind.HTTP))
    assertEquals(FileCategory.TORRENTS, FormatUtils.classifyFileName("linux.torrent", DownloadKind.TORRENT))

    val extracted = FormatUtils.extractMultipleSources(
      """
      https://example.com/a.zip
      magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567
      not-a-url
      """.trimIndent()
    )
    assertEquals(2, extracted.size)
  }
}
