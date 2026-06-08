using NXOpen;
using NXOpen.UF;
using NXSDK;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NXOpen.Drawings;
namespace NXTools
{
    public static class FileTools
    {
        /// <summary>
        /// 创建空的 prt 文件并设置为 WorkPart
        /// </summary>
        [Tool("CreateNewPart", "创建一个新的空 prt 文件并切换为当前工作部件（WorkPart）")]
        public static NXResult CreateNewPart(string folder_path, string part_name, bool overwrite = false)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(folder_path))
                    return NXResult.Fail("folder_path 不能为空");
                if (string.IsNullOrWhiteSpace(part_name))
                    return NXResult.Fail("part_name 不能为空");

                Directory.CreateDirectory(folder_path);

                // 统一后缀
                var fileName = part_name.EndsWith(".prt", StringComparison.OrdinalIgnoreCase)
                    ? part_name
                    : part_name + ".prt";

                var fullPath = Path.Combine(folder_path, fileName);

                if (File.Exists(fullPath) && !overwrite)
                    return NXResult.Fail("prt 文件已存在且 overwrite=false：" + fullPath);

                var session = Session.GetSession();

                // NX11：使用 FileNew 创建新部件
                FileNew fileNew = session.Parts.FileNew();
                fileNew.TemplateFileName = "model-plain-1-mm-template.prt"; 
                fileNew.Units = Part.Units.Millimeters;
                fileNew.NewFileName = fullPath;
                fileNew.MakeDisplayedPart = true;

                // Commit
                Part newPart = (Part)fileNew.Commit();
                fileNew.Destroy();

                // 切换 WorkPart
                session.Parts.SetWork(newPart);

                // 视图适配
                try { newPart.ModelingViews.WorkView.Fit(); } catch { }

                return NXResult.Success(new
                {
                    part_path = fullPath,
                    part_name = newPart.Name
                }, "新建 prt 成功，已切换为当前工作部件");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "CreateNewPart 失败");
            }
        }
        /*        [Tool("OpenPart", "打开模型")]
                public static NXResult OpenPart(string path)
                {
                    try
                    {
                        if (string.IsNullOrWhiteSpace(path))
                            return NXResult.Fail("path 不能为空");
                        var sess = NXContext.Session();
                        PartLoadStatus status;
                        BasePart part = sess.Parts.OpenBaseDisplay(path, out status);
                        status.Dispose();
                        return NXResult.Success(new { part_name = part.Name, part_path = part.FullPath, has_write_access = part.HasWriteAccess }, "打开模型成功");
                    }
                    catch (Exception ex)
                    {
                        return NXResult.FromException(ex, "打开模型失败");
                    }
                }*/

        [Tool("OpenTCPart", "打开 TC 主模型/主部件：根据 itemID 和可选 itemRev 使用 @DB/<item>/<rev> 打开；itemRev 为空时打开最新版本。不用于 specification/drawing 数据集。")]
        public static NXResult OpenTCPart(string itemID, string itemRev = "")
        {
            try
            {
                itemID = (itemID ?? string.Empty).Trim();
                itemRev = (itemRev ?? string.Empty).Trim();
                if (string.IsNullOrWhiteSpace(itemID))
                    return NXResult.Fail("itemID 不能为空");

                // 需要检查 TC 中这个 ITEM 是否存在。
                if (!IsPartExistInTC(itemID))
                {
                    return NXResult.Fail("TC 当中不存在该主模型 Item");
                }

                string revision = itemRev;
                if (string.IsNullOrWhiteSpace(revision))
                {
                    revision = AskPartLastRevisionID(itemID);
                }
                if (string.IsNullOrWhiteSpace(revision))
                {
                    return NXResult.Fail("未能获取 TC 主模型版本号");
                }

                string partItemIDVersion = itemID + "/" + revision;
                // 检查当前 NX 当中是否打开过同名或者同路径的模型。
                if (IsPartExistInSessionTC(partItemIDVersion))
                {
                    return NXResult.Fail("已打开过同名文件或不同版本的文件，请检查！");
                }

                UFSession ufSession = UFSession.GetUFSession();
                Tag partTag;
                UFPart.LoadStatus loadStatus;
                ufSession.Part.OpenQuiet("@DB/" + partItemIDVersion, out partTag, out loadStatus);
                if (partTag == Tag.Null)
                {
                    return NXResult.Fail("打开 TC 主模型失败");
                }
                ufSession.Part.SetDisplayPart(partTag);

                Session session = Session.GetSession();
                Part displayPart = session.Parts.Display;
                if (displayPart != null && !object.ReferenceEquals(session.Parts.Work, displayPart))
                {
                    session.Parts.SetWork(displayPart);
                }
                TryAction(delegate { session.ApplicationSwitchImmediate("UG_APP_GATEWAY"); });
                TryAction(delegate { session.ApplicationSwitchImmediate("UG_APP_MODELING"); });

                return NXResult.Success(new
                {
                    item_id = itemID,
                    item_rev_id = revision,
                    tc_db_path = "@DB/" + partItemIDVersion,
                    display_part = PartSnapshot(displayPart),
                    work_part = PartSnapshot(session.Parts.Work),
                    application = "UG_APP_MODELING"
                }, "打开 TC 主模型成功");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "打开 TC 主模型失败");
            }
        }
        [Tool("OpenTcDrawing", "打开 TC 已有二维图数据集：使用 Teamcenter 查询和用户选择得到的 tc_db_path，或由 item_id、item_rev_id、dataset_name、dataset_rev 组装 specification 路径；打开后进入 Drafting。")]
        public static NXResult OpenTcDrawing(string tc_db_path = "", string item_id = "", string item_rev_id = "", string dataset_name = "", string dataset_rev = "")
        {
            try
            {
                string tcDbPath = BuildTcDrawingPath(tc_db_path, item_id, item_rev_id, dataset_name, dataset_rev);
                if (string.IsNullOrWhiteSpace(tcDbPath))
                {
                    return NXResult.Fail("缺少 TC 图纸路径：请传 tc_db_path，或同时传 item_id、item_rev_id、dataset_name、dataset_rev");
                }
                if (tcDbPath.IndexOf("specification", StringComparison.OrdinalIgnoreCase) < 0)
                {
                    return NXResult.Fail("TC 图纸路径必须指向 specification/drawing 数据集，主模型请使用 nx_open_tcpart");
                }

                Session session = NXContext.Session();
                session.Parts.SetNonmasterSeedPartData(tcDbPath);

                PartLoadStatus status = null;
                BasePart basePart = session.Parts.OpenBaseDisplay(tcDbPath, out status);
                if (status != null)
                    status.Dispose();
                if (basePart == null)
                {
                    return NXResult.Fail("打开 TC 二维图失败：NX 未返回部件对象");
                }

                Part openedPart = basePart as Part;
                if (openedPart != null && !object.ReferenceEquals(session.Parts.Work, openedPart))
                {
                    session.Parts.SetWork(openedPart);
                }

                Part workPart = session.Parts.Work;
                if (workPart == null)
                    workPart = openedPart;
                if (workPart == null)
                {
                    return NXResult.Fail("打开 TC 二维图失败：当前没有 Work Part");
                }

                session.ApplicationSwitchImmediate("UG_APP_GATEWAY");
                session.ApplicationSwitchImmediate("UG_APP_DRAFTING");
                workPart.Drafting.EnterDraftingApplication();
                TryAction(delegate { workPart.Views.WorkView.UpdateCustomSymbols(); });
                TryAction(delegate { workPart.Drafting.SetTemplateInstantiationIsComplete(true); });

                return NXResult.Success(new
                {
                    tc_db_path = tcDbPath,
                    opened_part = PartSnapshot(basePart),
                    work_part = PartSnapshot(workPart),
                    display_part = PartSnapshot(session.Parts.Display),
                    application = "UG_APP_DRAFTING",
                    template_instantiation_complete = true
                }, "打开 TC 二维图成功，已进入 Drafting");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "打开 TC 二维图失败");
            }
        }

        /// <summary>
        /// 检查TC中是否存在对应的Item
        /// </summary>
        /// <param name="itemdIDI"></param>
        /// <returns></returns>
        public static bool IsPartExistInTC(string itemIDI)
        {
            Tag tcPartTag;
            try
            {
                UFSession.GetUFSession().Ugmgr.AskPartTag(itemIDI, out tcPartTag);
            }
            catch
            {
                tcPartTag = Tag.Null;
            }
            return tcPartTag != Tag.Null;
        }

        /// <summary>
        /// 获取Item的最新版本
        /// </summary>
        /// <param name="itemIDI"></param>
        /// <returns></returns>
        public static string AskPartLastRevisionID(string itemIDI)
        {
            string revisionID = null;
            Tag tcPartTag;
            var TheUFSession = UFSession.GetUFSession();
            TheUFSession.Ugmgr.AskPartTag(itemIDI, out tcPartTag);
            if (tcPartTag != Tag.Null)
            {
                int revCount;
                Tag[] revTagList;
                TheUFSession.Ugmgr.ListPartRevisions(tcPartTag, out revCount, out revTagList);
                if (revCount > 0)
                {
                    TheUFSession.Ugmgr.AskPartRevisionId(revTagList[revCount - 1], out revisionID);
                }
            }
            return revisionID;
        }

        /// <summary>
        /// 判断当前Session当中是否存在同名的部件
        /// </summary>
        /// <param name="itemIDVersionI">部件名称</param>
        /// <returns></returns>
        public static bool IsPartExistInSessionTC(string itemIDVersionI)
        {
            List<BasePart> allPartList = Session.GetSession().Parts.ToArray().ToList();
            List<string> allPartPathList = new List<string>();
            allPartList.ForEach(q => allPartPathList.Add(q.FullPath));
            int index = itemIDVersionI.LastIndexOf("/");
            if (index < 0)
            {
                return false;
            }
            string itemID = itemIDVersionI.Remove(index);
            foreach (string prtPath in allPartPathList)
            {
                string prtItemIDVersion;
                if (prtPath.Contains("specification"))
                {
                    string[] array = prtPath.Split(' ');
                    prtItemIDVersion = array[0];
                }
                else
                    prtItemIDVersion = prtPath;
                if (prtItemIDVersion == itemIDVersionI)
                {
                    return true;
                }
                else
                {
                    int indexOfSplit = prtItemIDVersion.LastIndexOf("/");
                    if (indexOfSplit != -1 && prtItemIDVersion.Remove(indexOfSplit) == itemID)
                    {
                        return true;
                    }
                }
            }
            return false;
        }

        private static string BuildTcDrawingPath(string tcDbPath, string itemId, string itemRevId, string datasetName, string datasetRev)
        {
            tcDbPath = (tcDbPath ?? string.Empty).Trim();
            if (!string.IsNullOrWhiteSpace(tcDbPath))
            {
                return NormalizeTcDbPath(tcDbPath);
            }

            itemId = (itemId ?? string.Empty).Trim();
            itemRevId = (itemRevId ?? string.Empty).Trim();
            datasetName = (datasetName ?? string.Empty).Trim();
            datasetRev = (datasetRev ?? string.Empty).Trim().TrimStart('/');

            if (string.IsNullOrWhiteSpace(itemId) ||
                string.IsNullOrWhiteSpace(itemRevId) ||
                string.IsNullOrWhiteSpace(datasetName) ||
                string.IsNullOrWhiteSpace(datasetRev))
            {
                return string.Empty;
            }

            if (datasetName.IndexOf("/", StringComparison.Ordinal) >= 0)
            {
                return NormalizeTcDbPath("@DB@" + itemId + "@" + itemRevId + "@specification@" + datasetName);
            }

            return NormalizeTcDbPath("@DB@" + itemId + "@" + itemRevId + "@specification@" + datasetName + "/" + datasetRev);
        }

        private static string NormalizeTcDbPath(string tcDbPath)
        {
            string path = (tcDbPath ?? string.Empty).Trim();
            if (path.StartsWith("@DB@", StringComparison.OrdinalIgnoreCase))
                return path;
            if (path.StartsWith("@DB/", StringComparison.OrdinalIgnoreCase))
                return path;
            return path;
        }

        private static object PartSnapshot(BasePart part)
        {
            if (part == null)
                return null;
            return new
            {
                part_name = part.Name,
                part_path = part.FullPath,
                has_write_access = part.HasWriteAccess
            };
        }

        private static void TryAction(Action action)
        {
            try
            {
                if (action != null)
                    action();
            }
            catch
            {
            }
        }



        [Tool("OpenPart", "打开本地或明确 NX 文件路径的部件；TC 主模型优先用 nx_open_tcpart，TC 已有二维图优先用 nx_open_tc_drawing。")]
        public static NXResult OpenPart(string path)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(path))
                    return NXResult.Fail("path 不能为空");

                var sess = NXContext.Session();

                // 规范化路径，避免相对路径 / 大小写 / 末尾分隔符导致的误判
                string targetPath = System.IO.Path.GetFullPath(path)
                    .TrimEnd(System.IO.Path.DirectorySeparatorChar, System.IO.Path.AltDirectorySeparatorChar);

                // 1) 若已打开：直接切换显示
                BasePart opened = null;

                // Session.Parts 是已打开零件集合；不同 NX 版本 API 细节可能略有差异，
                // 这里用 ToArray() 方式遍历（常见可用）。
                foreach (BasePart p in sess.Parts.ToArray())
                {
                    if (p == null) continue;

                    string pFullPath = (p.FullPath ?? string.Empty)
                        .TrimEnd(System.IO.Path.DirectorySeparatorChar, System.IO.Path.AltDirectorySeparatorChar);

                    if (string.Equals(pFullPath, targetPath, StringComparison.OrdinalIgnoreCase))
                    {
                        opened = p;
                        break;
                    }
                }

                if (opened != null)
                {
                    // 如果已经是当前显示，也视为成功（避免重复 SetDisplay）
                    if (!object.ReferenceEquals(sess.Parts.Display, opened))
                    {
                        PartLoadStatus st;
                        // NX 常用：SetDisplay(Part, allowAdditional, closeOthers, out status)
                        // allowAdditional=false：不额外加载
                        // closeOthers=false：不关闭其他已打开零件（你可按需求改为 true）
                        sess.Parts.SetDisplay((Part)opened, false, false, out st);
                        st.Dispose();
                    }

                    // 通常建议同步设为 WorkPart，避免后续建模/标注落在别的 work part 上
                    if (!object.ReferenceEquals(sess.Parts.Work, opened))
                    {
                        sess.Parts.SetWork((Part)opened);
                    }

                    return NXResult.Success(
                        new
                        {
                            part_name = opened.Name,
                            part_path = opened.FullPath,
                            has_write_access = opened.HasWriteAccess
                        },
                        "指定路径为已打开零件，已切换为当前显示"
                    );
                }

                // 2) 若未打开：打开新零件（保持你原来的行为）
                PartLoadStatus status;
                BasePart part = sess.Parts.OpenBaseDisplay(path, out status);
                status.Dispose();

                return NXResult.Success(
                    new
                    {
                        part_name = part.Name,
                        part_path = part.FullPath,
                        has_write_access = part.HasWriteAccess
                    },
                    "打开模型成功"
                );
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "打开模型失败");
            }
        }


        /*        [Tool("CreateImage", "导出图片")]
                public static NXResult CreateImage(string filePath, UFDisp.ImageFormat imageFormat = UFDisp.ImageFormat.Png, UFDisp.BackgroundColor color = UFDisp.BackgroundColor.White)
                {
                    try
                    {
                        if (string.IsNullOrWhiteSpace(filePath))
                            return NXResult.Fail("filePath 不能为空");

                        NXContext.UF().Disp.CreateImage(filePath, imageFormat, color);
                        return NXResult.Success(new { file_path = filePath, format = imageFormat.ToString() }, "图片导出成功");
                    }
                    catch (Exception ex)
                    {
                        return NXResult.FromException(ex, "图片导出失败");
                    }
                }*/

        [Tool("CreateImage", "导出图片")]
        public static NXResult CreateImage(string filePath, UFDisp.BackgroundColor color = UFDisp.BackgroundColor.White)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(filePath))
                    return NXResult.Fail("filePath 不能为空");

                // 1) 取后缀（统一小写）
                string ext = System.IO.Path.GetExtension(filePath);
                if (ext != null) ext = ext.Trim().ToLowerInvariant();

                UFDisp.ImageFormat imageFormat;

                // 2) 无后缀：直接失败（严格模式）
                if (string.IsNullOrWhiteSpace(ext))
                {
                    return NXResult.Fail("文件路径未包含图片后缀，无法识别导出格式");
                }

                // 3) 根据后缀映射格式
                if (ext == ".png")
                {
                    imageFormat = UFDisp.ImageFormat.Png;
                }
                else if (ext == ".jpg" || ext == ".jpeg")
                {
                    imageFormat = UFDisp.ImageFormat.Jpeg;
                }
                else if (ext == ".tif" || ext == ".tiff")
                {
                    imageFormat = UFDisp.ImageFormat.Tiff;
                }
                else if (ext == ".bmp")
                {
                    imageFormat = UFDisp.ImageFormat.Bmp;
                }
                else if (ext == ".gif")
                {
                    imageFormat = UFDisp.ImageFormat.Gif;
                }
                else
                {
                    // 4) 未识别后缀：返回 Fail
                    return NXResult.Fail("不支持的图片格式后缀: " + ext);
                }

                NXContext.UF().Disp.CreateImage(filePath, imageFormat, color);

                return NXResult.Success(
                    new { file_path = filePath, format = imageFormat.ToString() },
                    "图片导出成功"
                );
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "图片导出失败");
            }
        }


        [Tool("GetWorkPartInfo", "读取 Work Part 信息")]
        public static NXResult GetWorkPartInfo()
        {
            try
            {
                Part part = NXContext.WorkPart();
                return NXResult.Success(new { part_nane = part.Name, part_path = part.FullPath, has_write_access = part.HasWriteAccess }, "读取 Work Part 信息成功");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "读取 Work Part 信息失败");
            }
        }
        [Tool("GetDrawingSheetNameList", "读取当前工作部件所有图纸页名称")]
        public static List<string> GetDrawingSheetNameList()
        {
            Part workPart = NXContext.WorkPart();
            return workPart.DrawingSheets.ToArray().ToList().ConvertAll(q => q.Name);
        }
        [Tool("OpenDrawingSheet", "打开当前工作部件中指定名称的图纸页；不从 Teamcenter 定位或打开图纸数据集。")]
        public static NXResult OpenDrawingSheet(string drawSheetName)
        {
            Part workPart = NXContext.WorkPart();
            var currentDrwSheet = workPart.DrawingSheets.ToArray().ToList().Find(q => q.Name == drawSheetName);
            if(currentDrwSheet == null)
                return NXResult.Fail("未找到该名称的图纸页");
            currentDrwSheet.Open();
            return NXResult.Success("已成功打开该图纸页");
        }
        [Tool("Updatedrawings", "更新二维图纸")]
        public static NXResult Updatedrawings()
        {
            try
            {
                Session theSession = Session.GetSession();
                Part workPart = theSession.Parts.Work;
                if (workPart == null)
                    return NXResult.Fail("当前没有 Work Part");

                theSession.ApplicationSwitchImmediate("UG_APP_DRAFTING");
                workPart.Drafting.EnterDraftingApplication();

                int totalViews = 0;
                int updatedViews = 0;
                View[] draftingViews = workPart.DraftingViews.ToArray().OfType<View>().ToArray();
                foreach (View view in draftingViews)
                {
                    DraftingView draftingView = view as DraftingView;
                    if (draftingView == null)
                        continue;

                    totalViews++;
                    draftingView.Update();
                    updatedViews++;
                }

                try { workPart.Views.WorkView.UpdateCustomSymbols(); } catch { }

                Session.UndoMarkId mark = theSession.SetUndoMark(Session.MarkVisibility.Invisible, "Update Drafting Views");
                theSession.UpdateManager.DoUpdate(mark);

                return NXResult.Success(new
                {
                    drafting_view_count = totalViews,
                    updated_view_count = updatedViews
                }, "已成功更新二维图纸");
            }
            catch (Exception ex)
            {
                return NXResult.FromException(ex, "更新二维图纸失败");
            }
        }
    }
}





